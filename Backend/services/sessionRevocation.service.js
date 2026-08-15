'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const sessionRevocationEventModel = require('../models/sessionRevocationEvent.model');
const { deleteByPrefix } = require('../cache/cache');

const ACTOR_TYPES = new Set(['user', 'captain', 'admin']);
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.SESSION_REVOCATION_POLL_MS) || 5000);
const INSTANCE_ID = process.env.INSTANCE_ID
    || `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const handlers = new Set();
const processedEventIds = new Map();

let started = false;
let pollTimer = null;
let changeStream = null;
let connectedListener = null;
let pollInFlight = null;
let lastPollAt = new Date(Date.now() - POLL_INTERVAL_MS * 2);

function plainEvent(event) {
    return {
        eventId: String(event.eventId),
        scope: event.scope,
        actorType: event.actorType,
        actorId: String(event.actorId),
        jti: event.jti || null,
        reason: event.reason,
        createdAt: new Date(event.createdAt || Date.now()),
    };
}

function rememberEvent(eventId) {
    processedEventIds.set(eventId, Date.now());
    if (processedEventIds.size <= 2000) return;
    const oldest = [...processedEventIds.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, 500);
    oldest.forEach(([id]) => processedEventIds.delete(id));
}

function invalidateActorCache(event) {
    if (event.actorType === 'user') {
        deleteByPrefix(`profile:user:${event.actorId}`);
    } else if (event.actorType === 'captain') {
        deleteByPrefix(`profile:captain:${event.actorId}`);
        deleteByPrefix('drivers:');
    }
}

async function applyRevocationEvent(rawEvent) {
    const event = plainEvent(rawEvent);
    if (processedEventIds.has(event.eventId)) return false;
    rememberEvent(event.eventId);
    invalidateActorCache(event);

    const outcomes = await Promise.allSettled([...handlers].map((handler) => handler(event)));
    outcomes.forEach((outcome) => {
        if (outcome.status === 'rejected') {
            console.error('[SessionRevocation] Handler failed:', outcome.reason?.message || outcome.reason);
        }
    });
    return true;
}

async function publishRevocation({ scope = 'account', actorType, actorId, jti = null, reason = 'revoked' }) {
    if (!ACTOR_TYPES.has(actorType)) throw new Error('Tipo de ator inválido para revogação.');
    if (!actorId) throw new Error('actorId é obrigatório para revogação.');
    if (scope === 'session' && !jti) throw new Error('jti é obrigatório para revogar uma sessão.');

    const event = await sessionRevocationEventModel.create({
        scope,
        actorType,
        actorId,
        jti: scope === 'session' ? jti : null,
        reason,
    });
    await applyRevocationEvent(event);
    return plainEvent(event);
}

function registerRevocationHandler(handler) {
    if (typeof handler !== 'function') throw new TypeError('Handler de revogação inválido.');
    handlers.add(handler);
    return () => handlers.delete(handler);
}

async function runRevocationPoll() {
    if (mongoose.connection.readyState !== 1) return;
    const overlapStart = new Date(lastPollAt.getTime() - 1000);
    const pollEnd = new Date();
    let cursor = null;

    // Pagina até esgotar o intervalo. Atualizar o cursor temporal depois de apenas
    // 1000 registros perderia revogações justamente durante um bloqueio em lote.
    do {
        const windowFilter = { createdAt: { $gte: overlapStart, $lte: pollEnd } };
        const query = cursor ? {
            $and: [
                windowFilter,
                { $or: [
                    { createdAt: { $gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, _id: { $gt: cursor._id } },
                ] },
            ],
        } : windowFilter;
        const events = await sessionRevocationEventModel
            .find(query)
            .sort({ createdAt: 1, _id: 1 })
            .limit(1000)
            .lean();
        for (const event of events) await applyRevocationEvent(event);
        cursor = events.length === 1000 ? events[events.length - 1] : null;
    } while (cursor);

    lastPollAt = pollEnd;
}

function pollRevocations() {
    if (!pollInFlight) {
        pollInFlight = runRevocationPoll().finally(() => {
            pollInFlight = null;
        });
    }
    return pollInFlight;
}

function openChangeStream() {
    if (!started || changeStream || mongoose.connection.readyState !== 1) return;
    try {
        changeStream = sessionRevocationEventModel.watch([
            { $match: { operationType: 'insert' } },
        ], { fullDocument: 'updateLookup' });
        changeStream.on('change', (change) => {
            applyRevocationEvent(change.fullDocument).catch((error) => {
                console.error('[SessionRevocation] Change event failed:', error.message);
            });
        });
        changeStream.on('error', (error) => {
            console.error('[SessionRevocation] Change stream unavailable; polling remains active:', error.message);
            changeStream?.close().catch(() => {});
            changeStream = null;
        });
    } catch (error) {
        console.error('[SessionRevocation] Change stream unavailable; polling remains active:', error.message);
    }
}

function startRevocationSubscriber() {
    if (started) return;
    started = true;

    connectedListener = () => {
        if (!started) return;
        pollRevocations().catch((error) => console.error('[SessionRevocation] Initial poll failed:', error.message));
        openChangeStream();
    };
    if (mongoose.connection.readyState === 1) connectedListener();
    else mongoose.connection.once('connected', connectedListener);

    pollTimer = setInterval(() => {
        pollRevocations()
            .then(openChangeStream)
            .catch((error) => console.error('[SessionRevocation] Poll failed:', error.message));
    }, POLL_INTERVAL_MS);
    pollTimer.unref?.();
}

async function stopRevocationSubscriber() {
    started = false;
    if (connectedListener) mongoose.connection.off('connected', connectedListener);
    connectedListener = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (changeStream) await changeStream.close().catch(() => {});
    changeStream = null;
}

module.exports = {
    INSTANCE_ID,
    POLL_INTERVAL_MS,
    applyRevocationEvent,
    publishRevocation,
    registerRevocationHandler,
    startRevocationSubscriber,
    stopRevocationSubscriber,
};
