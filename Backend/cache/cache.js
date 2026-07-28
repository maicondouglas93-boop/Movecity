const NodeCache = require('node-cache');

// Criar uma única instância global do cache
const cache = new NodeCache({
    stdTTL: 3600, // 1 hora
    checkperiod: 600, // 10 minutos
    useClones: false
});

const isDev = process.env.NODE_ENV !== 'production';

function _log(type, key) {
    if (isDev) {
        let color = '\x1b[33m'; // Yellow
        if (type === 'HIT') color = '\x1b[32m'; // Green
        if (type === 'MISS') color = '\x1b[31m'; // Red
        if (type === 'DELETE') color = '\x1b[36m'; // Cyan
        console.log(`${color}[Cache ${type}]\x1b[0m ${key}`);
    }
}

/**
 * Obtém um item do cache
 */
function getCache(key) {
    try {
        const val = cache.get(key);
        if (val !== undefined) {
            _log('HIT', key);
            return val;
        }
        _log('MISS', key);
        return null;
    } catch (err) {
        console.error(`[Cache Error] getCache failed for key ${key}:`, err.message);
        return null; // Nunca interromper a aplicação
    }
}

/**
 * Salva um item no cache
 */
function setCache(key, value, ttlSeconds = null) {
    try {
        if (ttlSeconds !== null) {
            cache.set(key, value, ttlSeconds);
        } else {
            cache.set(key, value);
        }
        _log('SAVE', key);
        return true;
    } catch (err) {
        console.error(`[Cache Error] setCache failed for key ${key}:`, err.message);
        return false;
    }
}

/**
 * Exclui um item do cache
 */
function deleteCache(key) {
    try {
        cache.del(key);
        _log('DELETE', key);
        return true;
    } catch (err) {
        console.error(`[Cache Error] deleteCache failed for key ${key}:`, err.message);
        return false;
    }
}

/**
 * Limpa chaves por prefixo
 */
function deleteByPrefix(prefix) {
    try {
        const keys = cache.keys();
        const toDelete = keys.filter(k => k.startsWith(prefix));
        if (toDelete.length > 0) {
            cache.del(toDelete);
            toDelete.forEach(k => _log('DELETE', k));
        }
        return true;
    } catch (err) {
        console.error(`[Cache Error] deleteByPrefix failed for prefix ${prefix}:`, err.message);
        return false;
    }
}

/**
 * Limpa todo o cache
 */
function clearCache() {
    try {
        cache.flushAll();
        return true;
    } catch (err) {
        console.error(`[Cache Error] clearCache failed:`, err.message);
        return false;
    }
}

/**
 * Verifica se a chave existe
 */
function hasCache(key) {
    try {
        return cache.has(key);
    } catch (err) {
        console.error(`[Cache Error] hasCache failed for key ${key}:`, err.message);
        return false;
    }
}

module.exports = {
    getCache,
    setCache,
    deleteCache,
    deleteByPrefix,
    clearCache,
    hasCache,
    // Exporting raw instance for any advanced metrics if needed
    _instance: cache 
};
