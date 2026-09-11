package br.com.movecity.driver;

import org.junit.Test;
import static org.junit.Assert.*;

public class RideOfferModalSizingTest {
    @Test public void phoneKeeps16DpOnEachSide() {
        assertEquals(328, RideOfferModalSizing.width(360, 1));
        assertEquals(984, RideOfferModalSizing.width(1080, 3));
    }

    @Test public void tabletDoesNotStretchTheOfferAcrossTheScreen() {
        assertEquals(440, RideOfferModalSizing.width(1200, 1));
        assertEquals(880, RideOfferModalSizing.width(2400, 2));
    }

    @Test public void shortScreensKeepVerticalSpaceAroundTheModal() {
        assertEquals(420, RideOfferModalSizing.maxHeight(500, 1));
        assertEquals(268, RideOfferModalSizing.maxHeight(320, 1));
        assertTrue(RideOfferModalSizing.maxHeight(320, 1) < 320);
    }

    @Test public void tallScreensCapAt640DpInsteadOfLeavingEmptySpace() {
        assertEquals(640, RideOfferModalSizing.maxHeight(1000, 1));
        assertEquals(1920, RideOfferModalSizing.maxHeight(3000, 3));
    }

    @Test public void tinyOrNotYetMeasuredWindowsNeverProduceNegativeSpecs() {
        assertEquals(1, RideOfferModalSizing.width(0, 3));
        assertEquals(1, RideOfferModalSizing.maxHeight(0, 3));
    }
}
