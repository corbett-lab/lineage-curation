import { useCallback, useMemo } from "react";
import scale from "scale-color-perceptual";
import { isPangoLineage, generatePangoLineageColor } from "../utils/lineageUtils";
import { scaleLinear, ScaleLinear } from "d3-scale";
import type { Config } from "../types/backend";
import type { ColorHook } from "../types/color";

const rgb_cache: Record<string, [number, number, number]> = {};

const useColor = (
  config: Config,
  colorMapping: Record<string, [number, number, number]>,
  colorByField: string,
  lineageData?: Array<{ value: string; count: number }> | null
): ColorHook => {
  // Memoize the hierarchical color cache based on lineage data
  const hierarchicalColorCache = useMemo(() => {
    const cache: Record<string, [number, number, number]> = {};
    
    // Pre-compute colors for all lineages in the dataset if available
    if (lineageData && lineageData.length > 0) {
      console.log('Pre-computing hierarchical colors for', lineageData.length, 'lineages');
      
      // First, create a simple mapping for the JavaScript function
      const simpleLineageList = lineageData.map(item => item.value);
      
      // Temporarily modify the global lineage data for the JavaScript function
      (window as any).__taxoniumLineageData = simpleLineageList;
      
      lineageData.forEach(item => {
        if (typeof item.value === 'string' && /^[A-Za-z]/.test(item.value)) {
          cache[item.value] = generatePangoLineageColor(item.value) as [number, number, number];
        }
      });
      
      // Clean up the global variable
      delete (window as any).__taxoniumLineageData;
      
      console.log('Hierarchical color cache populated with', Object.keys(cache).length, 'entries');
    }
    
    return cache;
  }, [lineageData]);

  const colorScales = useMemo(() => {
    const scales: { colorRamp?: ScaleLinear<string, string> } = {};
    if (config.colorRamps && config.colorRamps[colorByField]) {
      const { scale: rampScale } = config.colorRamps[colorByField];
      const domain: number[] = rampScale.map((d) => d[0]);
      const range: string[] = rampScale.map((d) => d[1]);
      scales.colorRamp = scaleLinear<string, string>()
        .domain(domain)
        .range(range);
    }
    return scales;
  }, [config.colorRamps, colorByField]);
  
  const toRGB_uncached = useCallback(
    (string: string | number): [number, number, number] => {
      if (string === null || string === undefined) {
        return [150, 150, 150];
      }

      // Use hierarchical coloring for all string values with potential dot notation
      if (typeof string === 'string' && /^[A-Za-z]/.test(string)) {
        // Use cached color if available, otherwise compute it with simple method
        if (hierarchicalColorCache[string]) {
          console.log('Using cached hierarchical color for:', string, hierarchicalColorCache[string]);
          return hierarchicalColorCache[string];
        }
        console.log('Computing hierarchical color for:', string);
        const color = generatePangoLineageColor(string) as [number, number, number];
        console.log('Computed color:', color);
        return color;
      }

      // Special case for boolean string values
      if (string === 'true') {
        return [0, 180, 0];
      }
      if (string === 'false') {
        return [180, 0, 0];
      }

      if (config.colorRamps && config.colorRamps[colorByField]) {
        const numeric = parseFloat(String(string));
        const output = colorScales.colorRamp?.(numeric);
        if (!output) {
          return [120, 120, 120];
        }
        const as_list = output
          .slice(4, -1)
          .split(",")
          .map((d) => parseInt(d)) as [number, number, number];
        return as_list;
      }

      if (typeof string === "number") {
        const log10 = Math.log10(string);
        const scaled = log10 / 10;
        const clamped = Math.min(1, Math.max(0, scaled));
        const color = scale.plasma(clamped);
        // convert from hex to rgb
        const rgb: [number, number, number] = [
          parseInt(color.slice(1, 3), 16),
          parseInt(color.slice(3, 5), 16),
          parseInt(color.slice(5, 7), 16),
        ];
        return rgb;
      }

      if (typeof string === "string" && string in colorMapping) {
        return colorMapping[string];
      }

      const amino_acids: Record<string, [number, number, number]> = {
        A: [230, 25, 75],
        R: [60, 180, 75],
        N: [255, 225, 25],
        D: [67, 99, 216],
        C: [245, 130, 49],
        Q: [70, 240, 240],
        E: [145, 30, 180],
        G: [240, 50, 230],
        H: [188, 246, 12],
        I: [250, 190, 190],
        L: [230, 0, 255],
        K: [0, 128, 128],
        M: [154, 99, 36],
        F: [154, 60, 255],
        P: [128, 0, 0],
        T: [170, 255, 195],
        W: [128, 128, 0],
        Y: [0, 0, 117],
        V: [0, 100, 177],
        X: [128, 128, 128],
        O: [255, 255, 255],
        Z: [0, 0, 0],
      };

      if (typeof string === "string" && amino_acids[string]) {
        return amino_acids[string];
      }

      if (string === undefined) {
        return [200, 200, 200];
      }
      if (string === "") {
        return [200, 200, 200];
      }
      if (string === "unknown") {
        return [200, 200, 200];
      }
      if (string === "None") {
        return [220, 220, 220];
      }
      if (string === "N/A") {
        return [180, 180, 180];
      }
      if (string === "NA") {
        return [180, 180, 180];
      }

      // Special cases for specific strings
      const specialCases: Record<string, [number, number, number]> = {
        USA: [95, 158, 245],
        "B.1.2": [95, 158, 245],
        South_Africa: [9, 191, 255],
        England: [214, 58, 15],
        Scotland: [255, 130, 82],
        "North America": [200, 200, 50],
        "South America": [200, 100, 50],
        Wales: [148, 49, 22],
        "Northern Ireland": [140, 42, 15],
        France: [140, 28, 120],
        Germany: [106, 140, 28],
        India: [61, 173, 166],
        Denmark: [24, 112, 32],
        OXFORD_NANOPORE: [24, 32, 200],
        ION_TORRENT: [24, 160, 32],
        "Democratic Republic of the Congo": [17, 58, 99],
        Avian: [214, 58, 15],
      };

      if (typeof string === "string" && string in specialCases) {
        return specialCases[string];
      }

      let str = String(string);
      str = str.split("").reverse().join("");
      let hash = 0;
      if (str.length === 0) return [0, 0, 0];
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
      }
      let rgb: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 255;
        rgb[i] = value;
      }
      if (rgb[0] + rgb[1] + rgb[2] < 150 || rgb[0] + rgb[1] + rgb[2] > 500) {
        return toRGB_uncached(str + "_");
      }
      return rgb;
    },
    [colorMapping, config, colorByField, colorScales]
  );

  const toRGB = useCallback(
    (string: string | number): [number, number, number] => {
      // Always use hierarchical coloring for all lineage names
      if (string && typeof string === 'string') {
        // Use cached color if available, otherwise compute it
        if (hierarchicalColorCache[string]) {
          return hierarchicalColorCache[string];
        }
        return generatePangoLineageColor(string) as [number, number, number];
      }
      
      // For other values, use the cache
      if (rgb_cache[string] && !colorMapping[string]) {
        return rgb_cache[string];
      } else {
        const result = toRGB_uncached(string);
        if (typeof string === "string") {
          rgb_cache[string] = result;
        }
        return result;
      }
    },
    [toRGB_uncached, colorMapping, hierarchicalColorCache]
  );

  const toRGBCSS = useCallback(
    (val: string | number): string => {
      const output = toRGB(val);
      return `rgb(${output[0]},${output[1]},${output[2]})`;
    },
    [toRGB]
  );

  const output = useMemo(() => {
    return { toRGB, toRGBCSS };
  }, [toRGB, toRGBCSS]);
  return output;
};

export default useColor;
