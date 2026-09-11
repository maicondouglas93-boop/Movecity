package br.com.movecity.driver;

import android.content.Context;
import android.util.AttributeSet;
import android.widget.LinearLayout;

/** Encolhe ao conteúdo e limita altura; somente os detalhes internos rolam. */
public final class RideOfferModalLayout extends LinearLayout {
    private final int maxHeightPx;

    public RideOfferModalLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        float density = getResources().getDisplayMetrics().density;
        int available = Math.round(getResources().getConfiguration().screenHeightDp * density);
        if (available <= 0) available = getResources().getDisplayMetrics().heightPixels;
        // Limite calculado pelo viewport, não pela altura já reduzida da janela.
        // Assim os passes de medição de uma janela flutuante não a encolhem de novo.
        maxHeightPx = RideOfferModalSizing.maxHeight(available, density);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int limit = MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.UNSPECIFIED
            ? maxHeightPx : Math.min(maxHeightPx, MeasureSpec.getSize(heightMeasureSpec));
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(
            limit, MeasureSpec.AT_MOST));
    }
}
