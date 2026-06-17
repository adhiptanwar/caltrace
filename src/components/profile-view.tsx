import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn as useServerFnTanstack } from "@tanstack/react-start";
import { getProfile, upsertProfile } from "@/lib/profile.functions";
import { addWeight } from "@/lib/weights.functions";
import {
  ACTIVITY_OPTIONS,
  ageFromBirthDate,
  bmiCategory,
  calcBMI,
  calcBMR,
  calcTDEE,
  cmToFtIn,
  type ActivityLevel,
} from "@/lib/health-calc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Profile = {
  gender: "male" | "female" | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  goal_weight_kg: number | null;
};

const MIN_CM = 120;
const MAX_CM = 220;
const TICK_PX = 8; // px per cm on the ruler

export function ProfileView({ latestWeightKg, onChange }: { latestWeightKg: number | null; onChange: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFnTanstack(getProfile);
  const saveFn = useServerFnTanstack(upsertProfile);
  const addWeightFn = useServerFnTanstack(addWeight);

  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: () => (getFn as any)() as Promise<Profile | null>,
  });

  const p = profileQ.data;

  const [gender, setGender] = useState<"male" | "female">("male");
  const [birthDate, setBirthDate] = useState<string>("");
  const [heightCm, setHeightCm] = useState<number>(170);
  const [activity, setActivity] = useState<ActivityLevel>("sedentary");
  const [goalKg, setGoalKg] = useState<string>("");
  const [weightInput, setWeightInput] = useState<string>("");
  const [unit, setUnit] = useState<"cm" | "ft">("cm");

  // Hydrate from server once
  useEffect(() => {
    if (!p) return;
    if (p.gender) setGender(p.gender);
    if (p.birth_date) setBirthDate(p.birth_date);
    if (p.height_cm) setHeightCm(Number(p.height_cm));
    if (p.activity_level) setActivity(p.activity_level);
    if (p.goal_weight_kg != null) setGoalKg(String(p.goal_weight_kg));
  }, [p?.gender, p?.birth_date, p?.height_cm, p?.activity_level, p?.goal_weight_kg]);

  const effectiveWeight = latestWeightKg ?? (Number(weightInput) || null);
  const age = ageFromBirthDate(birthDate);
  const bmr = calcBMR({ gender, weight_kg: effectiveWeight, height_cm: heightCm, age });
  const tdee = calcTDEE(bmr, activity);
  const bmi = calcBMI(effectiveWeight, heightCm);
  const bmiCat = bmiCategory(bmi);

  const save = useMutation({
    mutationFn: async () => {
      const goal = Number(goalKg);
      await saveFn({
        data: {
          gender,
          birth_date: birthDate || null,
          height_cm: heightCm,
          activity_level: activity,
          goal_weight_kg: goal > 0 ? goal : null,
        },
      });
      // If no weight in history and user gave one here, log it
      if (latestWeightKg == null && weightInput) {
        const w = Number(weightInput);
        if (w > 0) await addWeightFn({ data: { weight_kg: w } });
      }
    },
    onSuccess: () => {
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["weights"] });
      onChange();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (profileQ.isLoading) {
    return (
      <div className="h-40 grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Stats summary */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Maintenance"
          value={tdee != null ? `${tdee}` : "—"}
          unit="kcal/day"
        />
        <StatCard
          label="BMI"
          value={bmi != null ? bmi.toFixed(1) : "—"}
          unit={bmiCat}
        />
      </div>

      {/* Gender */}
      <Section title="Gender">
        <div className="grid grid-cols-2 gap-2">
          {(["male", "female"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className={`h-11 rounded-xl border text-sm font-medium capitalize transition-colors ${
                gender === g ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-accent"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </Section>

      {/* Age */}
      <Section title="Date of birth">
        <Input
          type="date"
          value={birthDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirthDate(e.target.value)}
          className="h-11 rounded-xl"
        />
        {age != null && <div className="mt-1 text-xs text-muted-foreground">{age} years old</div>}
      </Section>

      {/* Weight (only editable if no logs) */}
      <Section title="Current weight">
        {latestWeightKg != null ? (
          <div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm">
            <span className="font-medium tabular-nums">{latestWeightKg.toFixed(1)} kg</span>
            <span className="text-muted-foreground"> · from latest log</span>
          </div>
        ) : (
          <Input
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder="Weight in kg"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            className="h-11 rounded-xl"
          />
        )}
      </Section>

      {/* Height ruler */}
      <Section
        title="Height"
        right={
          <div className="inline-flex rounded-lg border p-0.5 bg-muted text-[11px]">
            {(["cm", "ft"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-2 py-0.5 rounded-md transition-colors ${unit === u ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {u}
              </button>
            ))}
          </div>
        }
      >
        <HeightRuler value={heightCm} onChange={setHeightCm} gender={gender} unit={unit} />
      </Section>

      {/* Activity */}
      <Section title="Activity level">
        <div className="space-y-1.5">
          {ACTIVITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setActivity(o.value)}
              className={`w-full text-left rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                activity === o.value
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card hover:bg-accent"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Goal weight */}
      <Section title="Goal weight">
        <Input
          type="number"
          step="0.1"
          inputMode="decimal"
          placeholder="Goal in kg"
          value={goalKg}
          onChange={(e) => setGoalKg(e.target.value)}
          className="h-11 rounded-xl"
        />
      </Section>

      <Button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="h-12 w-full rounded-xl"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Save profile
      </Button>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">{title}</Label>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ----------- Height ruler with figure ----------- */

function HeightRuler({
  value,
  onChange,
  gender,
  unit,
}: {
  value: number;
  onChange: (cm: number) => void;
  gender: "male" | "female";
  unit: "cm" | "ft";
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(320);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerH(e.contentRect.height);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Scroll position: cm above MIN -> from bottom
  const totalCm = MAX_CM - MIN_CM;
  const totalPx = totalCm * TICK_PX;
  // padding so head-line sits in middle of container
  const padTop = containerH / 2;
  const padBottom = containerH / 2;

  // Sync external value -> scroll position
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const desiredTop = (MAX_CM - value) * TICK_PX;
    if (Math.abs(el.scrollTop - desiredTop) > 1) {
      programmatic.current = true;
      el.scrollTop = desiredTop;
      requestAnimationFrame(() => { programmatic.current = false; });
    }
  }, [value, containerH]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    if (programmatic.current) return;
    const top = e.currentTarget.scrollTop;
    const cm = Math.round(MAX_CM - top / TICK_PX);
    const clamped = Math.max(MIN_CM, Math.min(MAX_CM, cm));
    if (clamped !== value) onChange(clamped);
  }

  const ticks = useMemo(() => {
    const out: { cm: number; major: boolean; label: boolean }[] = [];
    for (let cm = MAX_CM; cm >= MIN_CM; cm--) {
      out.push({ cm, major: cm % 10 === 0, label: cm % 10 === 0 });
    }
    return out;
  }, []);

  const ftIn = cmToFtIn(value);


  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl border bg-card overflow-hidden"
      style={{ height: 340 }}
    >
      {/* Ruler scroller — left side */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="absolute inset-y-0 left-0 w-24 overflow-y-scroll touch-pan-y no-scrollbar"
        style={{ scrollSnapType: "y mandatory" }}
      >
        <div style={{ height: padTop }} />
        <div className="relative" style={{ height: totalPx }}>
          {ticks.map((t, i) => {
            const top = (MAX_CM - t.cm) * TICK_PX;
            return (
              <div
                key={t.cm}
                className="absolute left-0 right-0 flex items-center"
                style={{ top, height: 1, scrollSnapAlign: i === 0 ? "start" : undefined }}
              >
                <div
                  className={`bg-foreground/60 ${t.major ? "w-6" : "w-3"}`}
                  style={{ height: 1 }}
                />
                {t.label && (
                  <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">{t.cm}</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height: padBottom }} />
      </div>

      {/* Center head-line indicator across ruler */}
      <div
        className="pointer-events-none absolute left-0 right-0 flex items-center"
        style={{ top: "50%", transform: "translateY(-50%)" }}
      >
        <div className="h-px w-full bg-primary/70" />
      </div>

      {/* Readout */}
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-right">
        <div className="text-3xl font-semibold tabular-nums leading-none">
          {unit === "cm" ? value : `${ftIn.ft}'${ftIn.inch}"`}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
          {unit === "cm" ? "cm" : "ft / in"}
        </div>
      </div>

      {/* Figure: bottom-anchored, head aligns with center line */}
      <div className="pointer-events-none absolute left-28 right-24 bottom-0 flex items-end justify-center" style={{ height: "50%" }}>
        <FigureSvg gender={gender} style={{ height: "100%", width: "auto" }} />
      </div>
    </div>
  );
}

function FigureSvg({ gender, style }: { gender: "male" | "female"; style?: React.CSSProperties }) {
  // Simple silhouette
  if (gender === "female") {
    return (
      <svg viewBox="0 0 60 200" style={style} fill="currentColor" className="text-foreground/80">
        <circle cx="30" cy="14" r="10" />
        <path d="M22 26 h16 l4 22 c0 0 8 6 6 22 l-6 22 c-2 6 -4 8 -4 14 l4 60 c0 4 -2 6 -6 6 h-4 l-3 -50 h-2 l-3 50 h-4 c-4 0 -6 -2 -6 -6 l4 -60 c0 -6 -2 -8 -4 -14 l-6 -22 c-2 -16 6 -22 6 -22 z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 200" style={style} fill="currentColor" className="text-foreground/80">
      <circle cx="30" cy="14" r="10" />
      <path d="M14 38 c0 -6 4 -12 16 -12 s16 6 16 12 l-2 30 c0 4 -2 6 -4 8 l-2 14 c0 4 -2 6 -2 10 l4 60 c0 4 -2 6 -6 6 h-4 l-3 -50 h-2 l-3 50 h-4 c-4 0 -6 -2 -6 -6 l4 -60 c0 -4 -2 -6 -2 -10 l-2 -14 c-2 -2 -4 -4 -4 -8 z" />
    </svg>
  );
}
