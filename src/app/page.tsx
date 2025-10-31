"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import Papa from "papaparse";
import dynamic from "next/dynamic";
import type { Data, Layout } from "plotly.js-basic-dist";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/ui/shadcn-io/dropzone";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  ColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerOutput,
} from "@/components/ui/shadcn-io/color-picker";
import { useTheme } from "next-themes";
import { ThemeToggleButton } from "@/components/ui/shadcn-io/theme-toggle-button";

// Load Plotly and the react-plotly factory only on the client to avoid server-side
// evaluation of `plotly.js-basic-dist` (which references `self`/`window`).
const Plot = dynamic(async () => {
  const Plotly = await import("plotly.js-basic-dist");
  const factory = (await import("react-plotly.js/factory")).default;
  return factory(Plotly as unknown as typeof import("plotly.js-basic-dist"));
}, { ssr: false });

type Row = {
  study: string;
  // numeric fields can be missing for rows that only contain a study name
  effect?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
  weight?: number | null;
};

// Augmented row used internally: includes computed SE, computed weight and a flag
type AugRow = Row & {
  se: number | null;
  weightCalc: number;
  hasWeight: boolean;
};

export default function Home() {
  const { theme, setTheme } = useTheme();
  const handleThemeToggle = () => {
    // Toggle between 'dark' and 'light'. If theme is 'system' or undefined, treat non-'dark' as light.
    const current = theme ?? 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [isRatio, setIsRatio] = useState(true);
  // Mirror x-axis (e.g. show 5 -> 0.1 instead of 0.1 -> 5)
  const [mirrorX, setMirrorX] = useState(false);
  // Show grid lines on the plot (default true)
  const [showGrid, setShowGrid] = useState(true);
  const [xLabel, setXLabel] = useState("Effect");
  // track uploaded files so Dropzone can show content
  const [uploadedFiles, setUploadedFiles] = useState<File[] | undefined>(undefined);
  // Fullscreen state and viewport height for fullscreen plot
  const [fullOpen, setFullOpen] = useState(false);
  const [fullHeight, setFullHeight] = useState<number>(() => Math.max(600, typeof window !== "undefined" ? window.innerHeight - 120 : 600));
  const dataWrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const plotWrapperRef = useRef<HTMLDivElement>(null);

  // Slider states: percentages (default 100 to keep current size)
  const [tableWidthPercent, setTableWidthPercent] = useState<number>(100);
  const [plotWidthPercent, setPlotWidthPercent] = useState<number>(100);
  // Diamond size multiplier (1 = current default). Scales all marker sizes while keeping proportions.
  const [diamondScale, setDiamondScale] = useState<number>(1);

  // Color states: diamond fill color and connecting line color
  // make default slightly transparent (about 20% less opaque)
  const [diamondColor, setDiamondColor] = useState<string>("rgba(59,130,246,0.8)"); // default blue, 80% opacity
  // axis color controls the vertical reference line (e.g. x=1)
  const [axisColor, setAxisColor] = useState<string>("rgba(0,0,0,0.3)"); // default soft black used previously
  // ciColor controls the error/CI lines for each study (separate from diamond fill)
  const [ciColor, setCiColor] = useState<string>("rgba(59,130,246,0.8)");

  // Estimate label pixel width so we can expand the plot area when labels are long
  const estimatedLabelPx = useMemo(() => {
    const maxLabelLen = rows.reduce((m, r) => Math.max(m, (r.study || "").length), 0);
    return Math.min(2000, Math.max(100, 12 + maxLabelLen * 9));
  }, [rows]);

  // ----- CSV Parsing -----
  function parseCSV(file: File) {
    Papa.parse<Row>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data
          .map((r: Record<string, unknown>) => {
            const study = r.study ?? r.Study ?? r.name ?? r.Name ?? r.Studie ?? "";

            // Parse numeric fields if present, otherwise keep as null
            const tryNum = (v: unknown) => {
              if (v === null || v === undefined || v === "") return null;
              const n = Number(v);
              return Number.isFinite(n) ? n : null;
            };

            const effect = tryNum(r.effect ?? r.Effect ?? r.or ?? r.OR ?? r.value ?? r.ES ?? null);
            const ci_low = tryNum(r.ci_low ?? r.CI_low ?? r.ciLower ?? r.lower ?? r.Lower ?? r.Untere_KI ?? r.untere_KI ?? r.untere_ki ?? null);
            const ci_high = tryNum(r.ci_high ?? r.CI_high ?? r.ciUpper ?? r.upper ?? r.Upper ?? r.Obere_KI ?? r.obere_KI ?? r.obere_ki ?? null);
            const weight = tryNum(r.weight ?? r.Weight ?? null);

            // If no study present, skip the row entirely; otherwise keep the row even if numeric fields are missing
            if (!study) return null;

            return {
              study: String(study),
              effect,
              ci_low,
              ci_high,
              weight: weight != null ? weight : undefined,
            } as Row;
          })
          // keep rows that have at least a study
          .filter(Boolean) as Row[];
        setRows(parsed);
      },
      error: (err) => console.error("PapaParse error:", err),
    });
  }

  // Keep fullscreen height in sync with window size
  useEffect(() => {
    function update() {
      setFullHeight(Math.max(400, window.innerHeight - 120));
    }
    update();
    window.addEventListener("resize", update);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ----- Augment rows with SE and weight -----
  const augmented = useMemo<AugRow[]>(() => {
    return rows.map((r) => {
      // If a weight column is provided, use it directly and mark that the row has a weight
      if (r.weight != null) return { ...r, se: null as number | null, weightCalc: r.weight, hasWeight: true };

      // If numeric values are missing, we can't compute SE or weight; mark hasWeight=false
      if (r.effect == null || r.ci_low == null || r.ci_high == null) {
        return { ...r, se: null as number | null, weightCalc: 0, hasWeight: false };
      }

      const low = isRatio ? Math.max(1e-12, r.ci_low) : r.ci_low;
      const high = isRatio ? Math.max(1e-12, r.ci_high) : r.ci_high;
      const se = isRatio ? (Math.log(high) - Math.log(low)) / (2 * 1.96) : (high - low) / (2 * 1.96);
      const weightCalc = se > 0 ? 1 / (se * se) : 0;
      return { ...r, se, weightCalc, hasWeight: true };
    });
  }, [rows, isRatio]);

  // ----- Prepare Plotly data (two traces: CI lines + diamond markers) -----
  const plotData = useMemo<Data[] | null>(() => {
    if (augmented.length === 0) return null;

    const weights = augmented.map((r) => (r.weightCalc ?? 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const maxW = Math.max(...weights, 0.000001);
    const maxMarkerSize = 28;
    const minMarkerSize = 6;
    const markerSizes = weights.map((w) => ((w / maxW) * maxMarkerSize + minMarkerSize) * diamondScale);

    // Parse diamondColor into rgb + opacity so markers don't force CI alpha changes.
    let markerColorRgb = diamondColor;
    let markerOpacity = 1;
    try {
      const m = String(diamondColor).match(/rgba?\((\s*\d+\s*),\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\)/i);
      if (m) {
        const r = m[1].trim();
        const g = m[2].trim();
        const b = m[3].trim();
        const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
        markerColorRgb = `rgb(${r}, ${g}, ${b})`;
        markerOpacity = Number.isFinite(a) ? a : 1;
      }
    } catch {
      markerColorRgb = diamondColor;
      markerOpacity = 1;
    }

    // Build CI line trace: use null separators so each study's CI is a separate segment.
    const xLine: (number | null)[] = [];
    const yLine: (number | null)[] = [];
    augmented.forEach((r, i) => {
      const yPos = augmented.length - i;
      if (r.ci_low != null && r.ci_high != null) {
        xLine.push(r.ci_low, r.ci_high, null);
        yLine.push(yPos, yPos, null);
      } else {
        // push a null separator to keep segments aligned
        xLine.push(null);
        yLine.push(null);
      }
    });

    const ciTrace: Data = {
      x: xLine,
      y: yLine,
      mode: "lines",
      type: "scatter",
      line: { color: ciColor, width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    } as Data;

    // Marker trace (diamonds)
    const x = augmented.map((r) => (r.effect != null ? r.effect : null));
    const y = augmented.map((_, i) => augmented.length - i);

    const markerTrace: Data = {
      x,
      y,
      mode: "markers",
      type: "scatter",
      marker: { symbol: "diamond", size: markerSizes, line: { width: 1 }, color: markerColorRgb, opacity: markerOpacity },
      hoverinfo: "text",
      text: augmented.map((r) => {
        const pct = totalWeight === 0 ? 0 : ((r.weightCalc ?? 0) / totalWeight) * 100;
        const effectText = r.effect != null ? String(r.effect) : "";
        const ciText = r.ci_low != null && r.ci_high != null ? `[${r.ci_low}, ${r.ci_high}]` : "";
        const weightText = (!r.hasWeight || totalWeight === 0) ? "" : `Weight: ${pct.toFixed(1)}%`;
        const parts = [r.study, effectText ? `Effect: ${effectText}` : "", ciText ? `CI: ${ciText}` : "", weightText].filter(Boolean);
        return parts.join("<br>");
      }),
      showlegend: false,
    } as Data;

    return [ciTrace, markerTrace];
  }, [augmented, diamondScale, diamondColor, ciColor]);

  // ----- Compute Plot layout -----
  const layout = useMemo<Partial<Layout>>(() => {
    if (augmented.length === 0) return {};
    const yMin = 0;
    const yMax = augmented.length + 1;
    const desiredAxisY = yMin;
    const denom = yMax - yMin || 1;
    const axisPosition = (desiredAxisY - yMin) / denom;

    const maxLabelLen = augmented.reduce((m, r) => Math.max(m, (r.study || "").length), 0);
    const estimatedLabelPx = Math.min(600, Math.max(100, 12 + maxLabelLen * 8));
    const plotHeight = Math.max(400, augmented.length * 40 + 160);

    let tickvals: number[] | undefined = undefined;
    let ticktext: string[] | undefined = undefined;

    if (isRatio) {
      // Only include numeric x values when computing min/max
      const allX = augmented.flatMap(r => [r.ci_low, r.ci_high, r.effect].filter((v): v is number => v != null && Number.isFinite(v)));
      const xMin = allX.length ? Math.min(...allX) : 1;
      const xMax = allX.length ? Math.max(...allX) : 1;

      const decadeMin = Math.floor(Math.log10(Math.max(xMin, 1e-12)));
      const decadeMax = Math.ceil(Math.log10(Math.max(xMax, 1e-12)));

      const mantissasFull = [1,2,3,4,5,6,7,8,9];
      const mantissasReduced = [1,2,5];

      let candidates: number[] = [];
      for (let d = decadeMin; d <= decadeMax; d++) {
        for (const m of mantissasFull) {
          candidates.push(m * Math.pow(10, d));
        }
      }

      candidates = candidates.filter(v => v >= xMin && v <= xMax);

      const maxTicks = 12;
      if (candidates.length > maxTicks) {
        candidates = [];
        for (let d = decadeMin; d <= decadeMax; d++) {
          for (const m of mantissasReduced) {
            candidates.push(m * Math.pow(10, d));
          }
        }
        candidates = candidates.filter(v => v >= xMin && v <= xMax);
      }

      if (candidates.length === 0) {
        const steps = Math.min(6, Math.max(2, Math.ceil((xMax / xMin))));
        const logMin = Math.log10(xMin);
        const logMax = Math.log10(xMax);
        for (let i = 0; i <= steps; i++) {
          const v = Math.pow(10, logMin + (i / steps) * (logMax - logMin));
          candidates.push(v);
        }
      }

      const fmtVal = (v: number) => {
        if (v >= 1) {
          return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(1)));
        }
        const prec = v >= 0.1 ? 1 : 2;
        return v.toFixed(prec).replace(/^0(?=\.)/, '');
      };

      tickvals = candidates;
      ticktext = candidates.map(fmtVal);
    }

    // If mirrorX is enabled, flip the tick arrays so labels read from high → low
    if (mirrorX && tickvals && ticktext) {
      tickvals = [...tickvals].reverse();
      ticktext = [...ticktext].reverse();
    }

    return {
      autosize: true,
      margin: { l: estimatedLabelPx, r: 40, t: 40, b: 60 },
      xaxis: {
        title: { text: xLabel || "" },
        showgrid: showGrid,
        gridcolor: 'rgba(0,0,0,0.06)',
        type: isRatio ? "log" : undefined,
        zeroline: false,
        tickpadding: 2,
        ticklen: 6,
        position: Math.max(0, Math.min(1, axisPosition)),
        // When mirrorX is true we ask Plotly to reverse the axis so numbers display high→low
        ...(mirrorX ? { autorange: 'reversed' as const } : {}),
        ...(tickvals ? { tickmode: 'array' as const, tickvals, ticktext } : {}),
      },
      yaxis: {
        showgrid: showGrid,
        gridcolor: 'rgba(0,0,0,0.06)',
        tickmode: "array",
        tickvals: augmented.map((_, i) => augmented.length - i),
        ticktext: augmented.map((r) => r.study),
        range: [yMin, yMax],
        autorange: false,
        automargin: true,
      },
      shapes: [
        {
          type: "line",
          x0: isRatio ? 1 : 0,
          x1: isRatio ? 1 : 0,
          y0: yMin,
          y1: yMax,
          line: { color: axisColor, width: 2 },
        },
      ],
      height: plotHeight,
    };
  }, [augmented, isRatio, xLabel, mirrorX, showGrid, axisColor]);

  const plotHeight = Math.max(400, augmented.length * 40 + 160);

  // Generate a key for the Plot component so it will remount when layout-affecting
  // options change. Remounting forces Plotly to recompute axis ticks properly
  // (this mirrors the fix observed when opening fullscreen).
  const plotKey = useMemo(() => {
    return `p-${showGrid ? 1 : 0}-${isRatio ? 1 : 0}-${mirrorX ? 1 : 0}-${Math.round(diamondScale*10)}-${plotWidthPercent}-${estimatedLabelPx}`;
  }, [showGrid, isRatio, mirrorX, diamondScale, plotWidthPercent, estimatedLabelPx]);

  // Keep refs to the Plotly instances/graphDivs so we can call relayout/resize
  // when toggling options that Plotly sometimes doesn't recalc correctly in-place.
  const mainPlotRef = useRef<{ plotly: unknown; gd: unknown } | null>(null);
  const fullPlotRef = useRef<{ plotly: unknown; gd: unknown } | null>(null);

  // ColorPicker now emits a normalized rgba string like 'rgba(255, 0, 0, 1)'
  const handleDiamondColorChange = (v: string) => {
    if (v) setDiamondColor(v);
  };

  const handleCiColorChange = (v: string) => {
    if (v) setCiColor(v);
  };

  const handleAxisColorChange = (v: string) => {
    if (v) setAxisColor(v);
  };

  // Minimal type describing the Plotly subset we call at runtime. Use unknown
  // for inputs/outputs to avoid using `any` and satisfy lint rules.
  type PlotlyLike = {
    relayout?: (gd: unknown, update: Record<string, unknown>) => void;
    Plots?: { resize?: (gd: unknown) => void } | undefined;
    resize?: (gd: unknown) => void;
  };

  useEffect(() => {
    const el = dataWrapperRef.current;
    if (!el) return;
    const handleResize = () => {
      const contentWidth = el.scrollWidth;
      const winW = window.innerWidth;
      const parent = el.parentElement;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0 };
      const parentLeft = parentRect.left;
      // Only center the content when it fits inside the window. If the content
      // is wider than the viewport, leave marginLeft at 0 so the natural width
      // can overflow and the browser horizontal scrollbar is used.
      if (contentWidth <= winW) {
        const newMarginLeft = (winW - contentWidth) / 2 - parentLeft;
        el.style.marginLeft = `${newMarginLeft}px`;
      } else {
        el.style.marginLeft = `0px`;
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [augmented]);

  // When showGrid toggles, Plotly sometimes doesn't recompute tick placement
  // properly in-place. Dispatch a window resize shortly after toggling so
  // Plotly recalculates layout/ticks. This mirrors how opening fullscreen
  // forces a layout pass and fixes the jumbled labels.
  useEffect(() => {
    // trigger two resize events with a slight delay to ensure Plotly reacts
    const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    // Also instruct Plotly directly to relayout/showgrid and resize. We attempt
    // a couple of delayed calls to handle timing when the plot updates/remounts.
    const tryRelayout = (ref: { plotly: unknown; gd: unknown } | null) => {
      if (!ref || !ref.plotly || !ref.gd) return;
      try {
        // Narrow unknown to a small Plotly-like interface we can call safely.
        const plotly = ref.plotly as PlotlyLike;
        const gd = ref.gd;
        // update grid visibility explicitly
        if (typeof plotly.relayout === 'function') {
          plotly.relayout(gd, { 'xaxis.showgrid': showGrid, 'yaxis.showgrid': showGrid });
        }
        // force a resize/layout pass
        if (plotly.Plots && typeof plotly.Plots.resize === 'function') {
          plotly.Plots.resize(gd);
        } else if (typeof plotly.resize === 'function') {
          plotly.resize(gd);
        }
      } catch {
        // ignore; best-effort
      }
    };

    const r1 = setTimeout(() => tryRelayout(mainPlotRef.current || fullPlotRef.current), 80);
    const r2 = setTimeout(() => tryRelayout(mainPlotRef.current || fullPlotRef.current), 360);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(r1);
      clearTimeout(r2);
    };
  }, [showGrid]);

  useEffect(() => {
    const wrapper = tableRef.current;
    const plotWrap = plotWrapperRef.current;
    if (!wrapper || !plotWrap) return;

    function alignRowCenter() {
      const thead = wrapper!.querySelector('thead') as HTMLElement | null;
      const tbody = wrapper!.querySelector('tbody') as HTMLElement | null;
      const headerH = thead ? thead.offsetHeight : 0;
      const tbodyH = tbody ? tbody.offsetHeight : 0;
      const plotH = plotWrap!.clientHeight || plotHeight;
      const desiredTop = plotH / 2 - (headerH + tbodyH / 2);
      const marginTop = Math.max(0, Math.round(desiredTop));
      wrapper!.style.marginTop = `${marginTop}px`;
    }

    alignRowCenter();
    const t = setTimeout(alignRowCenter, 250);
    window.addEventListener('resize', alignRowCenter);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        alignRowCenter();
      });
      try {
        ro.observe(plotWrap);
        ro.observe(wrapper);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // ignore
      }
    }

    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', alignRowCenter);
      if (ro) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        try { ro.disconnect(); } catch (e) {}
      }
    };
  }, [augmented, plotHeight]);

  return (
    <main className="w-full p-8">
      <header className="mb-6 relative">
        {/* Theme toggle placed top-right, vertically centered to the header (matches headline) */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <ThemeToggleButton
            theme={theme === 'dark' ? 'dark' : 'light'}
            onClick={handleThemeToggle}
            aria-label="Toggle dark mode"
          />
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-center">Forest Plot Generator</h1>
        <p className="mt-2 text-muted-foreground text-sm text-center">Create forest plots from a CSV.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 mb-6 justify-items-center">
        <div className="inline-block w-max">
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV</CardTitle>
              <CardDescription>
                Required columns:<br/> <code>study,effect,ci_low,ci_high</code>. <br/>Optional columns:<br/> <code>weight</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dropzone
                src={uploadedFiles}
                accept={{ 'text/csv': ['.csv'] }}
                maxFiles={1}
                onDrop={(acceptedFiles) => {
                  const f = acceptedFiles?.[0];
                  if (f) {
                    setUploadedFiles([f]);
                    parseCSV(f);
                  }
                }}
              >
                <DropzoneEmptyState />
                <DropzoneContent />
              </Dropzone>

              {uploadedFiles && uploadedFiles.length > 0 && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <div className="text-slate-600">Selected: <strong className="text-slate-800 dark:text-slate-100">{uploadedFiles[0].name}</strong></div>
                  <Button variant="ghost" size="sm" onClick={() => { setUploadedFiles(undefined); setRows([]); }}>Remove</Button>
                </div>
              )}

              <div className="mt-4">
                <Label className="inline-flex items-center gap-2">
                  <Checkbox checked={isRatio} onCheckedChange={(v) => setIsRatio(Boolean(v))} />
                  <span className="text-sm">Treat effects as ratios (log-scale pooling)</span>
                </Label>
              </div>

              <div className="mt-2">
                <Label className="inline-flex items-center gap-2">
                  <Checkbox checked={mirrorX} onCheckedChange={(v) => setMirrorX(Boolean(v))} />
                  <span className="text-sm">Mirror x-axis (show high → low)</span>
                </Label>
              </div>

              <div className="mt-2">
                <Label className="inline-flex items-center gap-2">
                  <Checkbox checked={showGrid} onCheckedChange={(v) => setShowGrid(Boolean(v))} />
                  <span className="text-sm">Show grid</span>
                </Label>
              </div>

              <div className="mt-3">
                <Label className="mb-1 block">X axis label</Label>
                <Input value={xLabel} onChange={(e) => setXLabel((e.target as HTMLInputElement).value)} />
              </div>

              <div className="mt-3 flex gap-4 items-center">
                <div>
                  <Label className="mb-1 block">Diamond color</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      {/* asChild makes the child element the actual trigger to avoid nested buttons */}
                     <Button variant="outline" size="sm" style={{ background: diamondColor, borderColor: '#e2e8f0' }}>
                        <span className="sr-only">Open diamond color picker</span>
                        <div style={{ width: 18, height: 18, borderRadius: 4 }} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <div style={{ width: 300 }}>
                        <ColorPicker value={diamondColor} onChange={handleDiamondColorChange}>
                          <div style={{ height: 160 }}>
                            <ColorPickerSelection />
                          </div>
                          <div className="mt-3">
                            <ColorPickerHue />
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <ColorPickerAlpha className="flex-1" />
                            <ColorPickerEyeDropper />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <ColorPickerFormat />
                            <ColorPickerOutput />
                          </div>
                        </ColorPicker>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label className="mb-1 block">CI line color</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                     <Button variant="outline" size="sm" style={{ background: ciColor, borderColor: '#e2e8f0' }}>
                        <span className="sr-only">Open CI line color picker</span>
                        <div style={{ width: 18, height: 18, borderRadius: 4 }} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <div style={{ width: 300 }}>
                        <ColorPicker value={ciColor} onChange={handleCiColorChange}>
                          <div style={{ height: 160 }}>
                            <ColorPickerSelection />
                          </div>
                          <div className="mt-3">
                            <ColorPickerHue />
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <ColorPickerAlpha className="flex-1" />
                            <ColorPickerEyeDropper />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <ColorPickerFormat />
                            <ColorPickerOutput />
                          </div>
                        </ColorPicker>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                 <div>
                  <Label className="mb-1 block">Axis color</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                     <Button variant="outline" size="sm" style={{ background: axisColor, borderColor: '#e2e8f0' }}>
                        <span className="sr-only">Open axis color picker</span>
                        <div style={{ width: 18, height: 18, borderRadius: 4 }} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <div style={{ width: 300 }}>
                        <ColorPicker value={axisColor} onChange={handleAxisColorChange}>
                          <div style={{ height: 160 }}>
                            <ColorPickerSelection />
                          </div>
                          <div className="mt-3">
                            <ColorPickerHue />
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <ColorPickerAlpha className="flex-1" />
                            <ColorPickerEyeDropper />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <ColorPickerFormat />
                            <ColorPickerOutput />
                          </div>
                        </ColorPicker>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
               </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Allow the data area to be wider than the viewport and let the browser scroll horizontally */}
      <div style={{ width: "100%", display: "block", position: "relative", overflowX: 'auto', overflowY: 'visible' }}>
        <div ref={dataWrapperRef} style={{ width: "max-content", marginLeft: 0, overflow: 'visible' }}>
          <Card>
            <CardHeader>
              <CardTitle>Data view</CardTitle>
              <CardDescription>View parsed rows and the generated forest plot.</CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <div className="mt-3 text-sm text-muted-foreground">No data yet. Upload a CSV to begin.</div>
              ) : (
                <div className="mt-3">
                  {/* Slider controls for table/plot width - default 100% */}
                  <div className="mb-3 flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <Label className="whitespace-nowrap w-28 text-right">Table width</Label>
                      <Slider
                        min={30}
                        max={300}
                        value={[tableWidthPercent]}
                        onValueChange={(v) => setTableWidthPercent(v[0] ?? 100)}
                        className="w-72"
                      />
                      <div className="text-sm w-16 text-right">{tableWidthPercent}%</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="whitespace-nowrap w-28 text-right">Plot width</Label>
                      <Slider
                        min={30}
                        max={300}
                        value={[plotWidthPercent]}
                        onValueChange={(v) => setPlotWidthPercent(v[0] ?? 100)}
                        className="w-72"
                      />
                      <div className="text-sm w-16 text-right">{plotWidthPercent}%</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="whitespace-nowrap w-28 text-right">Diamond size</Label>
                      <Slider
                        min={0.5}
                        max={3}
                        step={0.1}
                        value={[diamondScale]}
                        onValueChange={(v) => setDiamondScale(v[0] ?? 1)}
                        className="w-72"
                      />
                      <div className="text-sm w-16 text-right">{diamondScale.toFixed(1)}x</div>
                    </div>
                  </div>
                  {/* align at top and offset the table so its center lines up with plot center */}
                  <div className="inline-flex items-start gap-6">
                    {/* left column: full table (no internal scrolling) */}
                    <div ref={tableRef} className="flex-shrink-0" style={{ width: `${Math.max(200, Math.round(600 * (tableWidthPercent / 100)))}px` }}>
                      <div style={{ width: '100%' }}>
                        <table className="text-sm table-fixed w-full">
                          <thead>
                            <tr className="text-left text-xs text-muted-foreground">
                              <th className="pb-2">Study</th>
                              <th className="pb-2 text-right">Effect</th>
                              <th className="pb-2 text-right">CI</th>
                              <th className="pb-2 text-right">Weight</th>
                            </tr>
                          </thead>
                          <tbody>
                            {augmented.map((r, i) => {
                              const totalWeight = augmented.reduce((a, b) => a + (b.weightCalc ?? 0), 0);
                              return (
                                <tr key={i} className="border-b last:border-b-0">
                                  {/* allow long study names to wrap inside the table cell */}
                                  <td className="py-2 pr-3 max-w-[250px] break-words">{r.study}</td>
                                  <td className="py-2 text-right pr-3">{r.effect != null ? r.effect : ""}</td>
                                  <td className="py-2 text-right pr-3">{(r.ci_low != null && r.ci_high != null) ? `[${r.ci_low}, ${r.ci_high}]` : ""}</td>
                                  <td className="py-2 text-right pr-1">{(totalWeight === 0 || !r.hasWeight) ? "" : ((r.weightCalc ?? 0) / totalWeight * 100).toFixed(1) + "%"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* right column: full-width plot */}
                    {/* Allow the plot wrapper to grow based on label width and the plot width percent */}
                    {/** Desired width grows with the slider but also ensures there's room for long study labels. */}
                    <div ref={plotWrapperRef} style={{ width: `${Math.max(300, Math.round(Math.max(900 * (plotWidthPercent / 100), estimatedLabelPx + 600)))}px`, overflow: 'visible' }}>
                      <div className="flex items-center justify-end mb-2">
                        <Button size="sm" onClick={() => setFullOpen(true)}>Full screen</Button>
                      </div>
                      {plotData && (
                        <div style={{ width: '100%' }}>
                          <Plot
                            key={plotKey}
                            data={plotData as Data[]}
                            layout={layout}
                            useResizeHandler={true}
                            onInitialized={(figure: unknown, plotly: unknown) => { mainPlotRef.current = { plotly, gd: figure }; }}
                            onUpdate={(figure: unknown, plotly: unknown) => { mainPlotRef.current = { plotly, gd: figure }; }}
                            style={{ width: "100%", height: plotHeight }}
                            config={{ responsive: true }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <div className="inline-block w-max">
          <Card>
            <CardContent>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 1010 10A10 10 0 0012 2z" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Tips</h4>
                  <ul className="text-sm space-y-1 list-inside list-disc">
                    <li>Make sure your headers contain no spaces between comma and value. This doesn&#39;t matter for any values besides the headers.</li>
                    <li>For ratios (odds ratios, risk ratios, hazard ratios): keep <strong>&quot;Treat effects as ratios&quot;</strong> checked to pool on the log scale.</li>
                    <li>For mean differences (0 = no effect): uncheck the ratio option.</li>
                    <li>Optional <code>weight</code> column will be used directly if provided; otherwise weights are estimated from CIs.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Fullscreen overlay for plot */}
      {fullOpen && plotData && (
        <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="relative w-full h-full p-6">
            <div className="absolute top-6 right-6 z-60">
              <Button variant="ghost" onClick={() => setFullOpen(false)}>Close</Button>
            </div>
            <div className="mx-auto h-full max-w-7xl rounded bg-white dark:bg-slate-900 p-4 shadow-lg" style={{ height: fullHeight, width: "calc(100% - 48px)" }}>
              <Plot
                key={plotKey + '-full'}
                data={plotData as Data[]}
                layout={{ ...layout, height: fullHeight }}
                useResizeHandler={true}
                onInitialized={(figure: unknown, plotly: unknown) => { fullPlotRef.current = { plotly, gd: figure }; }}
                onUpdate={(figure: unknown, plotly: unknown) => { fullPlotRef.current = { plotly, gd: figure }; }}
                style={{ width: "100%", height: fullHeight }}
                config={{ responsive: true }}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
