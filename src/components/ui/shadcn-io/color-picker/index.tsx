'use client';

import Color from 'color';
import { PipetteIcon } from 'lucide-react';
import { Slider } from 'radix-ui';
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface ColorPickerContextValue {
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
  mode: string;
  setHue: (hue: number) => void;
  setSaturation: (saturation: number) => void;
  setLightness: (lightness: number) => void;
  setAlpha: (alpha: number) => void;
  setMode: (mode: string) => void;
  // interaction helpers to suspend controlled syncing while user is interacting
  isInteracting: boolean;
  setIsInteracting: (v: boolean) => void;
}

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(
  undefined
);

export const useColorPicker = () => {
  const context = useContext(ColorPickerContext);

  if (!context) {
    throw new Error('useColorPicker must be used within a ColorPickerProvider');
  }

  return context;
};

export type ColorPickerProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value?: Parameters<typeof Color>[0];
  defaultValue?: Parameters<typeof Color>[0];
  // Emit a normalized color string to make controlled usage stable (no numeric-array <-> string back-and-forth)
  onChange?: (value: string) => void;
};

export const ColorPicker = ({
  value,
  defaultValue = '#000000',
  onChange,
  className,
  ...props
}: ColorPickerProps) => {
  // Normalize incoming values using Color and guard against invalid parses
  const selectedColor = (() => {
    try {
      return Color(value);
    } catch {
      try {
        return Color(defaultValue);
      } catch {
        return Color('#000000');
      }
    }
  })();

  const defaultColor = (() => {
    try {
      return Color(defaultValue);
    } catch {
      return Color('#000000');
    }
  })();

  // Helper to coerce numeric values safely
  const safeNum = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  const [hue, setHue] = useState<number>(() => {
    const h = selectedColor.hue();
    return safeNum(h, safeNum(defaultColor.hue(), 0));
  });
  const [saturation, setSaturation] = useState<number>(() => {
    const s = selectedColor.saturationl();
    return safeNum(s, safeNum(defaultColor.saturationl(), 100));
  });
  const [lightness, setLightness] = useState<number>(() => {
    const l = selectedColor.lightness();
    return safeNum(l, safeNum(defaultColor.lightness(), 50));
  });
  const [alpha, setAlpha] = useState<number>(() => {
    const a = selectedColor.alpha();
    return Math.round(safeNum(a, safeNum(defaultColor.alpha(), 1)) * 100);
  });
  const [mode, setMode] = useState('hex');
  const [isInteracting, setIsInteracting] = useState(false);

  // Refs to hold the latest state so we can compare when controlled `value` changes
  const hueRef = useRef(hue);
  const saturationRef = useRef(saturation);
  const lightnessRef = useRef(lightness);
  const alphaRef = useRef(alpha);

  // raf + last emitted refs to throttle emits and avoid ping-pong
  const emitRaf = useRef<number | null>(null);
  // store last emitted numeric color to compare numerically
  const lastEmittedNumeric = useRef<{ r: number; g: number; b: number; a: number } | null>(null);

  useEffect(() => {
    hueRef.current = hue;
  }, [hue]);
  useEffect(() => {
    saturationRef.current = saturation;
  }, [saturation]);
  useEffect(() => {
    lightnessRef.current = lightness;
  }, [lightness]);
  useEffect(() => {
    alphaRef.current = alpha;
  }, [alpha]);

  // Update color when controlled value changes - only apply differences to avoid re-triggering onChange
  useEffect(() => {
    if (value === undefined || value === null) return;
    // If user is actively interacting, don't sync from controlled value to avoid ping-pong
    if (isInteracting) return;

    try {
      // If the incoming value numerically matches what we last emitted, skip syncing to avoid ping-pong
      if (lastEmittedNumeric.current) {
        try {
          const inc = Color(value);
          const incRgb = inc.rgb().array().map((n) => Math.round(n));
          const incAlpha = Number(inc.alpha().toFixed(3));
          const le = lastEmittedNumeric.current;
          if (
            incRgb.length === 3 &&
            incRgb[0] === le.r &&
            incRgb[1] === le.g &&
            incRgb[2] === le.b &&
            Math.abs(incAlpha - le.a) <= 0.005
          ) {
            return;
          }
        } catch {
          // fall through to normal parsing
        }
      }

      const c = Color(value);
      const h = c.hue();
      const s = c.saturationl();
      const l = c.lightness();
      const a = c.alpha();

      // small tolerance for floating point comparisons
      const almostEqual = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;

      if (!Number.isNaN(h) && !almostEqual(hueRef.current, h)) {
        setHue(h);
      }
      if (!Number.isNaN(s) && !almostEqual(saturationRef.current, s)) {
        setSaturation(s);
      }
      if (!Number.isNaN(l) && !almostEqual(lightnessRef.current, l)) {
        setLightness(l);
      }
      if (!Number.isNaN(a)) {
        const alphaPct = Math.round(a * 100);
        if (!almostEqual(alphaRef.current, alphaPct, 1)) {
          setAlpha(alphaPct);
        }
      }
    } catch {
      // ignore parse errors
    }
    // Intentionally depend on `value` and `isInteracting` so we skip sync while interacting
  }, [value, isInteracting]);

  // Schedule emitting the current internal color to the parent, throttled to animation frames
  const scheduleEmit = useCallback(() => {
    if (!onChange) return;
    if (emitRaf.current !== null) {
      cancelAnimationFrame(emitRaf.current);
      emitRaf.current = null;
    }

    emitRaf.current = requestAnimationFrame(() => {
      try {
        const color = Color.hsl(hueRef.current, saturationRef.current, lightnessRef.current).alpha(alphaRef.current / 100);
        const rgbArr = color.rgb().array().map((n) => Math.round(n));
        const alphaNum = Number((color.alpha()).toFixed(3));
        const outString = `rgba(${rgbArr[0]}, ${rgbArr[1]}, ${rgbArr[2]}, ${alphaNum})`;

        // If incoming controlled value already equals our computed value numerically, skip emit
        if (value !== undefined && value !== null) {
          try {
            const inc = Color(value);
            const incRgb = inc.rgb().array().map((n) => Math.round(n));
            const incAlpha = Number(inc.alpha().toFixed(3));
            const sameRgb = incRgb.length === 3 && incRgb[0] === rgbArr[0] && incRgb[1] === rgbArr[1] && incRgb[2] === rgbArr[2];
            const sameAlpha = Math.abs(incAlpha - alphaNum) <= 0.005;
            if (sameRgb && sameAlpha) {
              lastEmittedNumeric.current = { r: rgbArr[0], g: rgbArr[1], b: rgbArr[2], a: alphaNum };
              emitRaf.current = null;
              return;
            }
          } catch {
            // fallthrough and emit
          }
        }

        // If we already emitted this exact numeric color, skip
        const le = lastEmittedNumeric.current;
        if (le && le.r === rgbArr[0] && le.g === rgbArr[1] && le.b === rgbArr[2] && Math.abs(le.a - alphaNum) <= 0.005) {
          emitRaf.current = null;
          return;
        }

        lastEmittedNumeric.current = { r: rgbArr[0], g: rgbArr[1], b: rgbArr[2], a: alphaNum };
        onChange(outString);
      } catch {
        // ignore
      } finally {
        emitRaf.current = null;
      }
    });
  }, [onChange, value]);

  // Trigger scheduleEmit whenever internal H/S/L/A changes
  useEffect(() => {
    scheduleEmit();
    return () => {
      if (emitRaf.current !== null) {
        cancelAnimationFrame(emitRaf.current);
        emitRaf.current = null;
      }
    };
  }, [hue, saturation, lightness, alpha, scheduleEmit]);

  return (
    <ColorPickerContext.Provider
      value={{
        hue,
        saturation,
        lightness,
        alpha,
        mode,
        setHue,
        setSaturation,
        setLightness,
        setAlpha,
        setMode,
        isInteracting,
        setIsInteracting,
      }}
    >
      <div
        className={cn('flex w-full h-full flex-col gap-4', className)}
        {...props}
      >
        {props.children}
      </div>
    </ColorPickerContext.Provider>
  );
};

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>;

export const ColorPickerSelection = memo(
  ({ className, ...props }: ColorPickerSelectionProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [positionX, setPositionX] = useState(0);
    const [positionY, setPositionY] = useState(0);
    const { hue, setSaturation, setLightness, setIsInteracting } = useColorPicker();

    const backgroundGradient = useMemo(() => {
      return `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`;
    }, [hue]);

    const handlePointerMove = useCallback(
      (event: PointerEvent) => {
        if (!(isDragging && containerRef.current)) {
          return;
        }
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width)
        );
        const y = Math.max(
          0,
          Math.min(1, (event.clientY - rect.top) / rect.height)
        );
        setPositionX(x);
        setPositionY(y);
        setSaturation(x * 100);
        const topLightness = x < 0.01 ? 100 : 50 + 50 * (1 - x);
        const lightness = topLightness * (1 - y);

        setLightness(lightness);
      },
      [isDragging, setSaturation, setLightness]
    );

    useEffect(() => {
      const handlePointerUp = () => setIsDragging(false);

      if (isDragging) {
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
      }

      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }, [isDragging, handlePointerMove]);

    return (
      <div
        className={cn('relative w-full h-full cursor-crosshair rounded', className)}
        onPointerDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
          // notify provider that user interaction started
          setIsInteracting(true);
          handlePointerMove(e.nativeEvent);
        }}
        ref={containerRef}
        style={{
          background: backgroundGradient,
        }}
        {...props}
      >
        <div
          className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
          style={{
            left: `${positionX * 100}%`,
            top: `${positionY * 100}%`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          }}
        />
      </div>
    );
  }
);

ColorPickerSelection.displayName = 'ColorPickerSelection';

export type ColorPickerHueProps = ComponentProps<typeof Slider.Root>;

export const ColorPickerHue = ({
  className,
  ...props
}: ColorPickerHueProps) => {
  const { hue, setHue, setIsInteracting } = useColorPicker();

  return (
    <Slider.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={360}
      onValueChange={([hue]) => setHue(hue)}
      onPointerDown={() => setIsInteracting(true)}
      onPointerUp={() => setIsInteracting(false)}
      step={1}
      value={[hue]}
      {...props}
    >
      <Slider.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <Slider.Range className="absolute h-full" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  );
};

export type ColorPickerAlphaProps = ComponentProps<typeof Slider.Root>;

export const ColorPickerAlpha = ({
  className,
  ...props
}: ColorPickerAlphaProps) => {
  const { alpha, setAlpha, setIsInteracting } = useColorPicker();

  return (
    <Slider.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={100}
      onValueChange={([alpha]) => setAlpha(alpha)}
      onPointerDown={() => setIsInteracting(true)}
      onPointerUp={() => setIsInteracting(false)}
      step={1}
      value={[alpha]}
      {...props}
    >
      <Slider.Track
        className="relative my-0.5 h-3 w-full grow rounded-full"
        style={{
          background:
            'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==") left center',
        }}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent to-black/50" />
        <Slider.Range className="absolute h-full rounded-full bg-transparent" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  );
};

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>;

export const ColorPickerEyeDropper = ({
  className,
  ...props
}: ColorPickerEyeDropperProps) => {
  const { setHue, setSaturation, setLightness, setAlpha } = useColorPicker();

  const handleEyeDropper = async () => {
    try {
      // @ts-expect-error - EyeDropper API is experimental
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();
      const color = Color(result.sRGBHex);
      const [h, s, l] = color.hsl().array();

      setHue(h);
      setSaturation(s);
      setLightness(l);
      setAlpha(100);
    } catch (error) {
      console.error('EyeDropper failed:', error);
    }
  };

  return (
    <Button
      className={cn('shrink-0 text-muted-foreground', className)}
      onClick={handleEyeDropper}
      size="icon"
      variant="outline"
      type="button"
      {...props}
    >
      <PipetteIcon size={16} />
    </Button>
  );
};

export type ColorPickerOutputProps = ComponentProps<typeof SelectTrigger>;

const formats = ['hex', 'rgb', 'css', 'hsl'];

export const ColorPickerOutput = ({
  className,
  ...props
}: ColorPickerOutputProps) => {
  const { mode, setMode } = useColorPicker();

  return (
    <Select onValueChange={setMode} value={mode}>
      <SelectTrigger className={cn('h-8 w-20 shrink-0 text-xs', className)} {...props}>
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {formats.map((format) => (
          <SelectItem className="text-xs" key={format} value={format}>
            {format.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

type PercentageInputProps = ComponentProps<typeof Input>;

const PercentageInput = ({ className, ...props }: PercentageInputProps) => {
  // Avoid using `any`. Pull `value` out of props safely via unknown, and keep the input controlled
  const { value: rawValue, ...rest } = props as unknown as { value?: string | number | null; [key: string]: unknown };
  const valueStr = rawValue === undefined || rawValue === null ? '' : String(rawValue);

  return (
    <div className="relative">
      <Input
        readOnly
        type="text"
        {...(rest as Record<string, unknown>)}
        value={valueStr}
        className={cn(
          'h-8 w-[3.25rem] rounded-l-none bg-secondary px-2 text-xs shadow-none',
          className
        )}
      />
      <span className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground text-xs">
        %
      </span>
    </div>
  );
};

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>;

export const ColorPickerFormat = ({
  className,
  ...props
}: ColorPickerFormatProps) => {
  const { hue, saturation, lightness, alpha, mode } = useColorPicker();
  const color = Color.hsl(hue, saturation, lightness, alpha / 100);

  if (mode === 'hex') {
    const hex = color.hex();

    return (
      <div
        className={cn(
          '-space-x-px relative flex w-full items-center rounded-md shadow-sm',
          className
        )}
        {...props}
      >
        <Input
          className="h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={hex}
        />
        <PercentageInput value={alpha} />
      </div>
    );
  }

  if (mode === 'rgb') {
    const rgb = color
      .rgb()
      .array()
      .map((value) => Math.round(value));

    return (
      <div
        className={cn(
          '-space-x-px flex items-center rounded-md shadow-sm',
          className
        )}
        {...props}
      >
        {rgb.map((value, index) => (
          <Input
            className={cn(
              'h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none',
              index && 'rounded-l-none',
              className
            )}
            key={index}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    );
  }

  if (mode === 'css') {
    const rgb = color
      .rgb()
      .array()
      .map((value) => Math.round(value));

    return (
      <div className={cn('w-full rounded-md shadow-sm', className)} {...props}>
        <Input
          className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={`rgba(${rgb.join(', ')}, ${alpha}%)`}
          {...props}
        />
      </div>
    );
  }

  if (mode === 'hsl') {
    const hsl = color
      .hsl()
      .array()
      .map((value) => Math.round(value));

    return (
      <div
        className={cn(
          '-space-x-px flex items-center rounded-md shadow-sm',
          className
        )}
        {...props}
      >
        {hsl.map((value, index) => (
          <Input
            className={cn(
              'h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none',
              index && 'rounded-l-none',
              className
            )}
            key={index}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    );
  }

  return null;
};
