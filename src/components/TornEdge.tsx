import React, { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  height: number;
  // Width of the ragged parchment band.
  bandWidth?: number;
  color: string;
}

// A vertical strip of "torn paper" — a straight outer edge and a ragged inner
// edge — drawn as a filled SVG path. Laid over the spine edge of a page as it
// rips away (left swipe) so the departing card reads as physically torn out.
export function TornEdge({ height, bandWidth = 18, color }: Props) {
  const d = useMemo(() => {
    const teeth = Math.max(6, Math.round(height / 24));
    const segH = height / teeth;
    let path = 'M0 0';
    for (let i = 0; i <= teeth; i++) {
      const y = i * segH;
      // Deterministic jitter so the tear looks irregular but stable per render.
      const jag = bandWidth + (i % 2 === 0 ? -5 : 4) + ((i * 41) % 6) - 3;
      path += ` L${jag.toFixed(1)} ${y.toFixed(1)}`;
    }
    path += ` L0 ${height} Z`;
    return path;
  }, [height, bandWidth]);

  return (
    <Svg width={bandWidth + 10} height={height} pointerEvents="none">
      <Path d={d} fill={color} stroke="rgba(40,52,44,0.18)" strokeWidth={0.75} />
    </Svg>
  );
}
