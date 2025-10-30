"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import Papa from "papaparse";
import dynamic from "next/dynamic";
import type { Data, Layout } from "plotly.js-basic-dist";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

// Load Plotly and the react-plotly factory only on the client to avoid server-side
// evaluation of `plotly.js-basic-dist` (which references `self`/`window`).
const Plot = dynamic(async () => {
  const Plotly = await import("plotly.js-basic-dist");
  const factory = (await import("react-plotly.js/factory")).default;
  return factory(Plotly as unknown as typeof import("plotly.js-basic-dist"));
}, { ssr: false });

type Row = {
  study: string;
  effect: number;
  ci_low: number;
  ci_high: number;
  weight?: number;
};

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [isRatio, setIsRatio] = useState(true);
  const [xLabel, setXLabel] = useState("Effect");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  // Fullscreen state and viewport height for fullscreen plot
  const [fullOpen, setFullOpen] = useState(false);
  const [fullHeight, setFullHeight] = useState<number>(() => Math.max(600, typeof window !== "undefined" ? window.innerHeight - 120 : 600));
  const dataWrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const plotWrapperRef = useRef<HTMLDivElement>(null);

  // Slider states: percentages (default 100 to keep current size)
  const [tableWidthPercent, setTableWidthPercent] = useState<number>(100);
  const [plotWidthPercent, setPlotWidthPercent] = useState<number>(100);

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
            const effect = r.effect ?? r.Effect ?? r.or ?? r.OR ?? r.value ?? r.ES ??  null;
            const ci_low = r.ci_low ?? r.CI_low ?? r.ciLower ?? r.lower ?? r.Lower ?? r.Untere_KI ?? r.untere_KI ?? r.untere_ki ?? null;
            const ci_high = r.ci_high ?? r.CI_high ?? r.ciUpper ?? r.upper ?? r.Upper ?? r.Obere_KI ?? r.obere_KI ?? r.obere_ki ?? null;
            const weight = r.weight ?? r.Weight ?? null;
            if (!study || effect == null || ci_low == null || ci_high == null) return null;
            return {
              study: String(study),
              effect: Number(effect),
              ci_low: Number(ci_low),
              ci_high: Number(ci_high),
              weight: weight != null ? Number(weight) : undefined,
            } as Row;
          })
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
  const augmented = useMemo(() => {
    return rows.map((r) => {
      if (r.weight != null) return { ...r, se: null as number | null, weightCalc: r.weight };
      const low = isRatio ? Math.max(1e-12, r.ci_low) : r.ci_low;
      const high = isRatio ? Math.max(1e-12, r.ci_high) : r.ci_high;
      const se = isRatio ? (Math.log(high) - Math.log(low)) / (2 * 1.96) : (high - low) / (2 * 1.96);
      const weightCalc = se > 0 ? 1 / (se * se) : 0;
      return { ...r, se, weightCalc };
    });
  }, [rows, isRatio]);

  // ----- Prepare Plotly data -----
  const plotData = useMemo<Data | null>(() => {
    if (augmented.length === 0) return null;
    const x = augmented.map((r) => r.effect);

    const error_x = {
      type: "data" as const,
      symmetric: false,
      array: augmented.map((r) => r.ci_high - r.effect),
      arrayminus: augmented.map((r) => r.effect - r.ci_low),
      thickness: 1.5,
      width: 0,
    };

    const weights = augmented.map((r) => r.weightCalc ?? 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const maxW = Math.max(...weights, 0.000001);
    const maxMarkerSize = 28;
    const minMarkerSize = 6;
    const markerSizes = weights.map((w) => (w / maxW) * maxMarkerSize + minMarkerSize);

    return ({
      x,
      y: augmented.map((_, i) => augmented.length - i),
      mode: "markers" as const,
      marker: { symbol: "diamond", size: markerSizes, line: { width: 1 } },
      error_x,
      type: "scatter" as const,
      hoverinfo: "text",
      text: augmented.map((r) => {
        const pct = totalWeight === 0 ? 0 : ((r.weightCalc ?? 0) / totalWeight) * 100;
        return `${r.study}<br>Effect: ${r.effect}<br>CI: [${r.ci_low}, ${r.ci_high}]<br>Weight: ${pct.toFixed(1)}%`;
      }),
      showlegend: false,
    } as Data);
  }, [augmented]);

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
      const allX = augmented.flatMap(r => [Math.max(1e-12, r.ci_low), Math.max(1e-12, r.ci_high), Math.max(1e-12, r.effect)]);
      const xMin = Math.min(...allX);
      const xMax = Math.max(...allX);

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

    return {
      autosize: true,
      margin: { l: estimatedLabelPx, r: 40, t: 40, b: 60 },
      xaxis: {
        title: { text: xLabel || "" },
        type: isRatio ? "log" : undefined,
        zeroline: false,
        tickpadding: 2,
        ticklen: 6,
        position: Math.max(0, Math.min(1, axisPosition)),
        ...(tickvals ? { tickmode: 'array' as const, tickvals, ticktext } : {}),
      },
      yaxis: {
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
          line: { color: "rgba(0,0,0,0.3)", width: 2 },
        },
      ],
      height: plotHeight,
    };
  }, [augmented, isRatio, xLabel]);

  const plotHeight = Math.max(400, augmented.length * 40 + 160);

  useEffect(() => {
    const el = dataWrapperRef.current;
    if (!el) return;
    const handleResize = () => {
      const contentWidth = el.scrollWidth;
      const winW = window.innerWidth;
      const parent = el.parentElement;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0 };
      const parentLeft = parentRect.left;
      const newMarginLeft = (winW - contentWidth) / 2 - parentLeft;
      el.style.marginLeft = `${newMarginLeft}px`;
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [augmented]);

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
      <header className="mb-6 text-center">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Forest Plot Generator</h1>
        <p className="mt-2 text-muted-foreground text-sm">Create forest plots from a CSV.</p>
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
              <input
                id="csv-file"
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setUploadedFileName(f.name);
                    parseCSV(f);
                  }
                }}
              />

              <label htmlFor="csv-file" className="w-full flex items-center gap-3 justify-center rounded-md border-2 border-dashed border-slate-200 dark:border-slate-700 p-3 cursor-pointer hover:border-sky-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M16 3v4M8 3v4m0 0h8" />
                </svg>
                <span className="text-sm">Click to upload a CSV or drag it here</span>
                <Badge className="ml-2" variant="secondary">CSV</Badge>
              </label>

              {uploadedFileName && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <div className="text-slate-600">Selected: <strong className="text-slate-800 dark:text-slate-100">{uploadedFileName}</strong></div>
                  <Button variant="ghost" size="sm" onClick={() => { setUploadedFileName(null); setRows([]); }}>Remove</Button>
                </div>
              )}

              <div className="mt-4">
                <Label className="inline-flex items-center gap-2">
                  <input id="ratio" type="checkbox" checked={isRatio} onChange={(e) => setIsRatio(e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm">Treat effects as ratios (log-scale pooling)</span>
                </Label>
              </div>

              <div className="mt-3">
                <Label className="mb-1 block">X axis label</Label>
                <Input value={xLabel} onChange={(e) => setXLabel(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div style={{ width: "100%", display: "block", position: "relative" }}>
        <div ref={dataWrapperRef} style={{ width: "max-content", marginLeft: 0 }}>
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
                      <input
                        type="range"
                        min={30}
                        max={100}
                        value={tableWidthPercent}
                        onChange={(e) => setTableWidthPercent(Number(e.target.value))}
                        className="w-72"
                      />
                      <div className="text-sm w-12 text-right">{tableWidthPercent}%</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="whitespace-nowrap w-28 text-right">Plot width</Label>
                      <input
                        type="range"
                        min={30}
                        max={100}
                        value={plotWidthPercent}
                        onChange={(e) => setPlotWidthPercent(Number(e.target.value))}
                        className="w-72"
                      />
                      <div className="text-sm w-12 text-right">{plotWidthPercent}%</div>
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
                                  <td className="py-2 text-right pr-3">{r.effect}</td>
                                  <td className="py-2 text-right pr-3">[{r.ci_low}, {r.ci_high}]</td>
                                  <td className="py-2 text-right pr-1">{((r.weightCalc ?? 0) / totalWeight * 100).toFixed(1)}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* right column: full-width plot */}
                    <div ref={plotWrapperRef} style={{ width: `${Math.max(300, Math.round(900 * (plotWidthPercent / 100)))}px` }}>
                      <div className="flex items-center justify-end mb-2">
                        <Button size="sm" onClick={() => setFullOpen(true)}>Full screen</Button>
                      </div>
                      {plotData && (
                        <div style={{ width: '100%' }}>
                          <Plot
                            data={[plotData] as Data[]}
                            layout={layout}
                            useResizeHandler={true}
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
                data={[plotData] as Data[]}
                layout={{ ...layout, height: fullHeight }}
                useResizeHandler={true}
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
