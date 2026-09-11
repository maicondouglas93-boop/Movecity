package br.com.movecity.driver;

import org.junit.Test;
import java.time.Instant;
import static org.junit.Assert.*;

public class RideOfferPresentationPolicyTest {
    private final long now = Instant.parse("2026-09-11T17:00:00Z").toEpochMilli();

    @Test public void foregroundDoesNotRequireOverlayPermission() {
        assertTrue(RideOfferPresentationPolicy.mayOpenActivity(true, false));
        assertTrue(RideOfferPresentationPolicy.mayOpenActivity(true, true));
    }

    @Test public void backgroundRequiresExplicitOverlayPermission() {
        assertTrue(RideOfferPresentationPolicy.mayOpenActivity(false, true));
        assertFalse(RideOfferPresentationPolicy.mayOpenActivity(false, false));
    }

    @Test public void legacyPayloadHasAtMost45Seconds() {
        assertEquals(now + 45_000, RideOfferPresentationPolicy.deadline(null, now));
        assertEquals(now + 45_000, RideOfferPresentationPolicy.deadline("", now));
    }

    @Test public void delayedPushOnlyGetsRemainingTime() {
        long deadline = RideOfferPresentationPolicy.deadline("2026-09-11T17:00:45.000Z", now + 30_000);
        assertEquals(15_000, RideOfferPresentationPolicy.remaining(deadline, now + 30_000));
        assertEquals(0, RideOfferPresentationPolicy.remaining(deadline, now + 45_000));
    }

    @Test public void expiredOrMalformedPayloadNeverReopensOffer() {
        for (String value : new String[]{"bad-date", "2026-09-11T16:59:59Z", "2026-09-11T17:00:00Z",
                "2026-09-11T17:00:10Zgarbage", "2026-02-31T17:00:00Z"}) {
            assertEquals(value, 0, RideOfferPresentationPolicy.remaining(
                RideOfferPresentationPolicy.deadline(value, now), now));
        }
    }

    @Test public void isoOffsetsAndNumericDeadlinesAreSupported() {
        for (String value : new String[]{"2026-09-11T14:00:20-03:00", "2026-09-11T17:00:20Z",
                String.valueOf(now + 20_000)}) {
            assertEquals(now + 20_000, RideOfferPresentationPolicy.deadline(value, now));
        }
    }

    @Test public void futureClockOrPayloadCannotCreateEndlessScreen() {
        assertEquals(now + 45_000, RideOfferPresentationPolicy.deadline("2099-01-01T00:00:00Z", now));
        assertEquals(45_000, RideOfferPresentationPolicy.remaining(now + 120_000, now));
    }

    @Test public void reopeningScreenDoesNotRestartCountdown() {
        long deadline = now + 45_000;
        assertEquals(25_000, RideOfferPresentationPolicy.remaining(deadline, now + 20_000));
        assertEquals(5_000, RideOfferPresentationPolicy.remaining(deadline, now + 40_000));
        assertEquals(0, RideOfferPresentationPolicy.remaining(deadline, now + 90_000));
    }
}
