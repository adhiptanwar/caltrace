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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Loader2, User, Briefcase, Activity, Dumbbell, Flame, Trophy, Pencil, Settings2 } from "lucide-react";


type Profile = {
  gender: "male" | "female" | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  goal_weight_kg: number | null;
};

type Meal = { calories: number; eaten_at: string };


const MIN_CM = 120;
const MAX_CM = 220;
const TICK_PX = 6; // px per cm on the ruler

const ACTIVITY_DETAILS: Record<ActivityLevel, { icon: React.ComponentType<any>; label: string; desc: string }> = {
  sedentary: { icon: Briefcase, label: "Sedentary", desc: "Office job" },
  light: { icon: Activity, label: "Light", desc: "1-2 days/wk" },
  moderate: { icon: Dumbbell, label: "Moderate", desc: "3-5 days/wk" },
  heavy: { icon: Flame, label: "Active", desc: "6-7 days/wk" },
  athlete: { icon: Trophy, label: "Athlete", desc: "2x per day" },
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function ProfileView({
  latestWeightKg,
  maintenance,
  meals,
  onChange,
}: {
  latestWeightKg: number | null;
  maintenance: number | null;
  meals: Meal[];
  onChange: () => void;
}) {
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
  const [projWindow, setProjWindow] = useState<"7" | "30" | "all">("all");
  const [editOpen, setEditOpen] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    if (!p) return;
    if (p.gender) setGender(p.gender);
    if (p.birth_date) setBirthDate(p.birth_date);
    if (p.height_cm) setHeightCm(Number(p.height_cm));
    if (p.activity_level) setActivity(p.activity_level);
    if (p.goal_weight_kg != null) setGoalKg(String(p.goal_weight_kg));
    requestAnimationFrame(() => { hydrated.current = true; });
  }, [p]);

  const effectiveWeight = latestWeightKg ?? (Number(weightInput) || null);
  const age = ageFromBirthDate(birthDate);
  const bmr = calcBMR({ gender, weight_kg: effectiveWeight, height_cm: heightCm, age });
  const tdee = calcTDEE(bmr, activity);
  const bmi = calcBMI(effectiveWeight, heightCm);
  const bmiCat = bmiCategory(bmi);

  // Goal projection
  const goalNum = Number(goalKg);
  const projection = useMemo(() => {
    if (!effectiveWeight || !goalNum || maintenance == null) return null;
    const diffKg = effectiveWeight - goalNum;
    if (Math.abs(diffKg) < 0.05) return { reached: true as const };
    const needLose = diffKg > 0;
    const windowDays = projWindow === "all" ? null : Number(projWindow);
    const todayStart = startOfDay(new Date());
    const since = windowDays == null ? null : new Date(todayStart.getTime() - windowDays * 86400_000);
    const recent = meals.filter((m) => {
      const t = new Date(m.eaten_at);
      if (t >= todayStart) return false; // exclude today
      if (since && t < since) return false;
      return true;
    });
    if (recent.length === 0) return { reached: false as const, days: null, avgIntake: 0, direction: needLose ? "lose" : "gain" as const };
    const totals = new Map<string, number>();
    recent.forEach((m) => {
      const k = startOfDay(new Date(m.eaten_at)).toISOString();
      totals.set(k, (totals.get(k) ?? 0) + (m.calories || 0));
    });
    const avgIntake = Array.from(totals.values()).reduce((a, b) => a + b, 0) / Math.max(totals.size, 1);
    const deficit = maintenance - avgIntake;
    const effective = needLose ? deficit : -deficit;
    if (effective <= 0) return { reached: false as const, days: null, avgIntake: Math.round(avgIntake), direction: needLose ? "lose" : "gain" as const };
    const days = Math.ceil((Math.abs(diffKg) * 7700) / effective);
    return { reached: false as const, days, avgIntake: Math.round(avgIntake), deficit: Math.round(deficit), direction: needLose ? "lose" : "gain" as const };
  }, [effectiveWeight, goalNum, maintenance, meals, projWindow]);

  const save = useMutation({
    mutationFn: async (payload: {
      gender: "male" | "female";
      birth_date: string | null;
      height_cm: number;
      activity_level: ActivityLevel;
      goal_weight_kg: number | null;
    }) => {
      await saveFn({ data: payload });
      return payload;
    },
    onSuccess: (payload) => {
      // Update cache directly — no refetch — so local state isn't clobbered mid-edit.
      qc.setQueryData(["profile"], (prev: any) => ({ ...(prev ?? {}), ...payload }));
      onChange();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Autosave profile fields (debounced) once initial data is hydrated.
  useEffect(() => {
    if (!hydrated.current) return;
    const goal = Number(goalKg);
    const payload = {
      gender,
      birth_date: birthDate || null,
      height_cm: heightCm,
      activity_level: activity,
      goal_weight_kg: goal > 0 ? goal : null,
    };
    const t = setTimeout(() => save.mutate(payload), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender, birthDate, heightCm, activity, goalKg]);

  // Autosave initial weight log if user enters one (only when no prior logs).
  useEffect(() => {
    if (!hydrated.current) return;
    if (latestWeightKg != null) return;
    const w = Number(weightInput);
    if (!(w > 0)) return;
    const t = setTimeout(async () => {
      try {
        await addWeightFn({ data: { weight_kg: w } });
        qc.invalidateQueries({ queryKey: ["weights"] });
        onChange();
      } catch (e: any) {
        toast.error(e.message);
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightInput, latestWeightKg]);

  if (profileQ.isLoading) {
    return (
      <div className="h-40 grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Maintenance" value={tdee != null ? `${tdee}` : "—"} unit="kcal/day" />
        <StatCard label="BMI" value={bmi != null ? bmi.toFixed(1) : "—"} unit={bmiCat} />
      </div>

      {/* Gender */}
      <Section title="Gender">
        <div className="grid grid-cols-2 gap-2">
          {(["male", "female"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className={`h-10 rounded-xl border text-sm font-medium capitalize transition-colors ${
                gender === g ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-accent"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </Section>

      {/* DOB + Height side by side */}
      <div className="grid grid-cols-2 gap-3">
        <Section title="Date of birth">
          <Input
            type="date"
            value={birthDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBirthDate(e.target.value)}
            className="h-12 rounded-xl w-full min-w-0 flex items-center justify-center text-base font-semibold px-3 py-0 text-center border-border bg-card shadow-none focus-visible:ring-1 focus-visible:ring-ring appearance-none [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:p-0 [&::-webkit-date-and-time-value]:h-5 [&::-webkit-date-and-time-value]:text-center [&::-webkit-date-and-time-value]:flex [&::-webkit-date-and-time-value]:items-center [&::-webkit-date-and-time-value]:justify-center"
          />
          {age != null && <div className="mt-1 text-[11px] text-muted-foreground">{age} years old</div>}
        </Section>

        <Section title="Height">
          <Dialog>
            <DialogTrigger asChild>
              <button className="h-12 w-full rounded-xl border bg-card px-3 flex items-center justify-between hover:bg-accent transition-colors">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="text-base font-semibold tabular-nums leading-none">
                  {unit === "cm"
                    ? `${heightCm} cm`
                    : (() => { const f = cmToFtIn(heightCm); return `${f.ft}'${f.inch}"`; })()}
                </div>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-3 pr-6">
                  <span>Set height</span>
                  <div className="inline-flex rounded-lg border p-0.5 bg-muted text-[11px] font-normal">
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
                </DialogTitle>
              </DialogHeader>
              <HeightRuler value={heightCm} onChange={setHeightCm} unit={unit} />
            </DialogContent>
          </Dialog>
        </Section>
      </div>

      {/* Weight (only if no logs) */}
      {latestWeightKg == null && (
        <Section title="Current weight">
          <Input
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder="Weight in kg"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            className="h-10 rounded-xl"
          />
        </Section>
      )}

      {/* Activity */}
      <Section title="Activity level">
        <div className="grid grid-cols-5 gap-1.5">
          {ACTIVITY_OPTIONS.map((o) => {
            const details = ACTIVITY_DETAILS[o.value];
            const Icon = details.icon;
            const active = activity === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setActivity(o.value)}
                className={`rounded-xl border p-1.5 flex flex-col items-center text-center transition-colors select-none min-w-0 ${
                  active
                    ? "bg-foreground text-background border-foreground font-medium"
                    : "bg-card hover:bg-accent border-border"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 mb-1 ${active ? "text-background" : "text-muted-foreground"}`} />
                <span className="text-[10px] font-semibold leading-tight truncate w-full">{details.label}</span>
                <span className={`text-[9px] mt-0.5 leading-tight truncate w-full ${active ? "text-background/80" : "text-muted-foreground"}`}>
                  {details.desc}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Goal */}
      <Section title="Goal">
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Input
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder="Goal weight"
              value={goalKg}
              onChange={(e) => setGoalKg(e.target.value)}
              className="h-10 rounded-xl flex-1"
            />
            <span className="text-sm text-muted-foreground">kg</span>
          </div>
          {effectiveWeight != null && goalNum > 0 && (
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">{effectiveWeight.toFixed(1)} <span className="text-xs text-muted-foreground font-normal">kg</span></div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">To go</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">{(effectiveWeight - goalNum).toFixed(1)} <span className="text-xs text-muted-foreground font-normal">kg</span></div>
              </div>
            </div>
          )}
          {effectiveWeight != null && goalNum > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg intake window</Label>
                <div className="inline-flex rounded-lg border p-0.5 bg-muted text-[11px]">
                  {([
                    { v: "7", l: "7d" },
                    { v: "30", l: "30d" },
                    { v: "all", l: "All" },
                  ] as const).map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setProjWindow(o.v)}
                      className={`px-2 py-0.5 rounded-md transition-colors ${projWindow === o.v ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              {projection && (
                <div className="text-xs text-muted-foreground">
                  {projection.reached
                    ? "Goal reached 🎯"
                    : projection.days == null
                    ? `Avg intake ${projection.avgIntake} kcal — adjust to ${projection.direction} weight`
                    : (() => {
                        const d = projection.days;
                        const eta = new Date(Date.now() + d * 86400_000);
                        return `~${d} days (≈ ${eta.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}) at ${projection.avgIntake} kcal/day avg`;
                      })()}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{unit}</div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</Label>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ----------- Height ruler with figure (full-card scrollable) ----------- */

function HeightRuler({
  value,
  onChange,
  unit,
}: {
  value: number;
  onChange: (cm: number) => void;
  unit: "cm" | "ft";
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const CONTAINER_H = 220;
  const totalCm = MAX_CM - MIN_CM;
  const totalPx = totalCm * TICK_PX;
  const padTop = CONTAINER_H / 2;
  const padBottom = CONTAINER_H / 2;

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
  }, [value]);

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
    <div className="relative rounded-2xl border bg-card overflow-hidden" style={{ height: CONTAINER_H }}>
      {/* Full-card scroller — scrolling anywhere on this card adjusts height */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-scroll touch-pan-y no-scrollbar"
      >
        <div style={{ height: padTop }} />
        <div className="relative" style={{ height: totalPx }}>
          {ticks.map((t) => {
            const top = (MAX_CM - t.cm) * TICK_PX;
            return (
              <div
                key={t.cm}
                className="absolute left-0 flex items-center"
                style={{ top, height: 1 }}
              >
                <div className={`bg-foreground/50 ${t.major ? "w-5" : "w-2.5"}`} style={{ height: 1 }} />
                {t.label && (
                  <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">{t.cm}</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height: padBottom }} />
      </div>

      {/* Center indicator line */}
      <div className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2">
        <div className="h-px w-full bg-primary/70" />
      </div>

      {/* Readout */}
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-right">
        <div className="text-2xl font-semibold tabular-nums leading-none">
          {unit === "cm" ? value : `${ftIn.ft}'${ftIn.inch}"`}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
          {unit === "cm" ? "cm" : "ft / in"}
        </div>
      </div>

      {/* Figure: bottom anchored, head at center line */}
      <div className="pointer-events-none absolute left-20 right-20 bottom-0 flex items-end justify-center" style={{ height: "50%" }}>
        <User className="h-full w-auto text-foreground/40 stroke-[1.25]" />
      </div>
    </div>
  );
}
