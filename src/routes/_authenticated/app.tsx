import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn as useServerFnTanstack } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { analyzeMealImage } from "@/lib/ai.functions";
import { addMeal, listMeals, deleteMeal, updateMeal } from "@/lib/meals.functions";
import { addWeight, listWeights, deleteWeight } from "@/lib/weights.functions";
import { categoryFromDate, downscaleImage, type MealCategory } from "@/lib/meal-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, ReferenceLine,
} from "recharts";
import { Camera, Plus, Trash2, LogOut, Loader2, Home, BarChart3, Scale, Sun, Moon, ChevronRight, User } from "lucide-react";
import logoBlack from "@/assets/trace-mark-black.png.asset.json";
import logoWhite from "@/assets/trace-mark-white.png.asset.json";
import { getProfile } from "@/lib/profile.functions";
import { calcBMR, calcTDEE, type ActivityLevel } from "@/lib/health-calc";
import { ageFromBirthDate } from "@/lib/health-calc";
import { ProfileView } from "@/components/profile-view";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Trace — Food & Weight" }] }),
  component: AppPage,
});

type MealItem = { name: string; portion?: string; quantity: number; calories: number; protein_g: number; carbs_g: number; fat_g: number };

type Meal = {
  id: string;
  name: string;
  description: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  items: any[];
  category: MealCategory;
  eaten_at: string;
  image_url: string | null;
};

type Weight = { id: string; weight_kg: number; logged_at: string };
type TabKey = "today" | "history" | "weight" | "profile";
const TABS: TabKey[] = ["today", "history", "weight", "profile"];

type ProfileRow = {
  gender: "male" | "female" | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  goal_weight_kg: number | null;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtDay(d: Date) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function fmtTime(d: Date) { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function fmtShort(d: Date) { return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }); }

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
    setDark(next);
  }
  return { dark, toggle };
}

function normalizeItems(raw: any): MealItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it: any) => ({
    name: String(it?.name ?? "Item"),
    portion: it?.portion ? String(it.portion) : undefined,
    quantity: Number(it?.quantity ?? 1) || 1,
    calories: Number(it?.calories ?? 0) || 0,
    protein_g: Number(it?.protein_g ?? 0) || 0,
    carbs_g: Number(it?.carbs_g ?? 0) || 0,
    fat_g: Number(it?.fat_g ?? 0) || 0,
  }));
}

function AppPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listMealsFn = useServerFnTanstack(listMeals);
  const listWeightsFn = useServerFnTanstack(listWeights);
  const { dark, toggle } = useDarkMode();
  const [tab, setTab] = useState<TabKey>("today");

  useEffect(() => {
    document.documentElement.classList.add("app-scroll-locked");
    document.body.classList.add("app-scroll-locked");
    return () => {
      document.documentElement.classList.remove("app-scroll-locked");
      document.body.classList.remove("app-scroll-locked");
    };
  }, []);

  const mealsQ = useQuery({
    queryKey: ["meals"],
    queryFn: () => listMealsFn({ data: {} }) as Promise<Meal[]>,
  });
  const weightsQ = useQuery({
    queryKey: ["weights"],
    queryFn: () => listWeightsFn({ data: {} }) as Promise<Weight[]>,
  });
  const getProfileFn = useServerFnTanstack(getProfile);
  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: () => (getProfileFn as any)() as Promise<ProfileRow | null>,
  });

  const latestWeightKg = useMemo(() => {
    const ws = weightsQ.data ?? [];
    if (ws.length === 0) return null;
    return Number(ws[ws.length - 1].weight_kg);
  }, [weightsQ.data]);

  const maintenance = useMemo(() => {
    const p = profileQ.data;
    if (!p) return null;
    const age = ageFromBirthDate(p.birth_date);
    const bmr = calcBMR({
      gender: p.gender,
      weight_kg: latestWeightKg,
      height_cm: p.height_cm,
      age,
    });
    return calcTDEE(bmr, p.activity_level);
  }, [profileQ.data, latestWeightKg]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  // Swipe to switch tabs
  const touch = useRef<{ x: number; y: number; t: number; locked: boolean | null } | null>(null);
  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(false);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now(), locked: null };
    setAnimating(false);
  }
  function onTouchMove(e: React.TouchEvent) {
    const start = touch.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (start.locked === null && Math.abs(dx) + Math.abs(dy) > 10) {
      start.locked = Math.abs(dx) > Math.abs(dy);
    }
    if (start.locked === true) {
      const idx = TABS.indexOf(tab);
      let clamped = dx;
      if (idx === 0 && dx > 0) clamped = dx * 0.3;
      if (idx === TABS.length - 1 && dx < 0) clamped = dx * 0.3;
      setDragX(clamped);
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) { setDragX(0); return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    const isSwipe = start.locked === true && dt < 600 && Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx);
    const idx = TABS.indexOf(tab);
    setAnimating(true);
    if (isSwipe && dx < 0 && idx < TABS.length - 1) {
      const w = window.innerWidth;
      setDragX(-w);
      setTimeout(() => { setAnimating(false); setDragX(0); setTab(TABS[idx + 1]); }, 180);
    } else if (isSwipe && dx > 0 && idx > 0) {
      const w = window.innerWidth;
      setDragX(w);
      setTimeout(() => { setAnimating(false); setDragX(0); setTab(TABS[idx - 1]); }, 180);
    } else {
      setDragX(0);
      setTimeout(() => setAnimating(false), 180);
    }
  }

  return (
    <div className="fixed inset-0 h-[100dvh] w-full min-h-0 overscroll-none flex flex-col bg-background overflow-hidden touch-none">
      <header
        className="shrink-0 border-b bg-background/85 backdrop-blur z-30"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-xl px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logoBlack.url} alt="" className="h-6 w-6 object-contain shrink-0 dark:hidden" />
            <img src={logoWhite.url} alt="" className="h-6 w-6 object-contain shrink-0 hidden dark:block" />
            <h1 className="text-base font-semibold tracking-tight leading-none">Trace</h1>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggle} aria-label="Toggle theme" className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-1">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={signOut} aria-label="Sign out" className="text-muted-foreground hover:text-foreground transition-colors p-2">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main
        className="min-h-0 flex-1 overflow-y-auto overscroll-none mx-auto w-full max-w-xl px-5 pt-4 touch-pan-x"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)",
          transform: `translate3d(${dragX}px, 0, 0)`,
          transition: animating ? "transform 180ms ease-out" : "none",
          willChange: "transform",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {tab === "today" && (
          <TodayView meals={mealsQ.data ?? []} loading={mealsQ.isLoading} onChange={() => qc.invalidateQueries({ queryKey: ["meals"] })} />
        )}
        {tab === "history" && <HistoryView meals={mealsQ.data ?? []} maintenance={maintenance} onChange={() => qc.invalidateQueries({ queryKey: ["meals"] })} />}
        {tab === "weight" && (
          <WeightView
            weights={weightsQ.data ?? []}
            maintenance={maintenance}
            goalKg={profileQ.data?.goal_weight_kg ?? null}
            meals={mealsQ.data ?? []}
            onChange={() => qc.invalidateQueries({ queryKey: ["weights"] })}
          />
        )}
        {tab === "profile" && (
          <ProfileView
            latestWeightKg={latestWeightKg}
            onChange={() => {
              qc.invalidateQueries({ queryKey: ["weights"] });
              qc.invalidateQueries({ queryKey: ["profile"] });
            }}
          />
        )}
      </main>

      <nav
        className="fixed inset-x-0 z-40 flex justify-center pointer-events-none"
        style={{ bottom: "max(calc(env(safe-area-inset-bottom) - 8px), 0.75rem)" }}
      >
        <div className="pointer-events-auto rounded-full border bg-background/90 backdrop-blur shadow-lg shadow-black/10 dark:shadow-black/40 px-1.5 py-1.5 flex items-center gap-1">
          <NavBtn label="Today" icon={<Home className="h-[18px] w-[18px]" />} active={tab === "today"} onClick={() => setTab("today")} />
          <NavBtn label="History" icon={<BarChart3 className="h-[18px] w-[18px]" />} active={tab === "history"} onClick={() => setTab("history")} />
          <NavBtn label="Weight" icon={<Scale className="h-[18px] w-[18px]" />} active={tab === "weight"} onClick={() => setTab("weight")} />
          <NavBtn label="Profile" icon={<User className="h-[18px] w-[18px]" />} active={tab === "profile"} onClick={() => setTab("profile")} />
        </div>
      </nav>
    </div>
  );
}

function NavBtn({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium transition-colors ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ViewMoreButton({ label, count, onClick }: { label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
    >
      <span className="flex items-center gap-2">
        {label}
        {typeof count === "number" && (
          <span className="text-xs text-muted-foreground tabular-nums">({count})</span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

/* ---------------- Today ---------------- */

function TodayView({ meals, loading, onChange }: { meals: Meal[]; loading: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const today = startOfDay(new Date());
  const todays = meals.filter((m) => startOfDay(new Date(m.eaten_at)).getTime() === today.getTime());
  const total = todays.reduce((s, m) => s + (m.calories || 0), 0);
  const protein = todays.reduce((s, m) => s + (Number(m.protein_g) || 0), 0);
  const carbs = todays.reduce((s, m) => s + (Number(m.carbs_g) || 0), 0);
  const fat = todays.reduce((s, m) => s + (Number(m.fat_g) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Today</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-5xl font-semibold tabular-nums">{total}</div>
          <div className="text-sm text-muted-foreground">kcal</div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          <MacroPill label="Protein" value={`${Math.round(protein)}g`} />
          <MacroPill label="Carbs" value={`${Math.round(carbs)}g`} />
          <MacroPill label="Fat" value={`${Math.round(fat)}g`} />
        </div>
      </div>

      <AddMealButton onAdded={onChange} />

      <ViewMoreButton
        label={loading ? "Loading…" : "View today's meals"}
        count={todays.length}
        onClick={() => setOpen(true)}
      />

      <TodayMealsSheet open={open} onOpenChange={setOpen} todays={todays} onChange={onChange} />
    </div>
  );
}

function TodayMealsSheet({ open, onOpenChange, todays, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; todays: Meal[]; onChange: () => void }) {
  const grouped: Record<MealCategory, Meal[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
  todays.forEach((m) => grouped[m.category as MealCategory]?.push(m));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col rounded-t-2xl">
        <SheetHeader className="p-5 pb-3 shrink-0">
          <SheetTitle>Today's meals</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-5">
          {todays.length === 0 ? (
            <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
              No meals logged today.
            </div>
          ) : (
            (["breakfast", "lunch", "dinner", "snack"] as MealCategory[]).map((cat) =>
              grouped[cat].length === 0 ? null : (
                <div key={cat}>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground capitalize">{cat}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {grouped[cat].reduce((s, m) => s + m.calories, 0)} kcal
                    </div>
                  </div>
                  <div className="space-y-2">
                    {grouped[cat].map((m) => <MealRow key={m.id} meal={m} onChange={onChange} />)}
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MacroPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted py-2">
      <div className="text-sm font-medium tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function MealRow({ meal, onChange }: { meal: Meal; onChange: () => void }) {
  const delFn = useServerFnTanstack(deleteMeal);
  const [editing, setEditing] = useState(false);
  const del = useMutation({
    mutationFn: () => delFn({ data: { id: meal.id } }),
    onSuccess: () => { onChange(); toast.success("Removed"); },
    onError: (e: any) => toast.error(e.message),
  });
  const pending = del.isPending;
  return (
    <>
      <div className={`flex items-start gap-3 rounded-xl border bg-card p-3 transition-opacity ${pending ? "opacity-50" : ""}`}>
        <button
          onClick={() => { if (!pending) setEditing(true); }}
          disabled={pending}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-medium truncate">{meal.name}</div>
            <div className="text-sm tabular-nums shrink-0">{meal.calories} kcal</div>
          </div>
          {meal.description && <div className="text-xs text-muted-foreground truncate">{meal.description}</div>}
          <div className="mt-1 text-[11px] text-muted-foreground">{fmtTime(new Date(meal.eaten_at))}</div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); if (!pending) del.mutate(); }}
          disabled={pending}
          aria-label="Delete meal"
          className="text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors p-2 -m-1"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
      {editing && (
        <EditMealDialog meal={meal} onClose={() => setEditing(false)} onSaved={onChange} />
      )}
    </>
  );
}

/* ---------------- Meal Editor (shared) ---------------- */

type Draft = {
  name: string; description: string; calories: number;
  protein_g: number; carbs_g: number; fat_g: number;
  items: MealItem[];
  autoTotals: boolean;
};

function MealEditorForm({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const recomputed = draft.items.reduce(
    (acc, it) => {
      acc.calories += it.calories * it.quantity;
      acc.protein_g += it.protein_g * it.quantity;
      acc.carbs_g += it.carbs_g * it.quantity;
      acc.fat_g += it.fat_g * it.quantity;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const totals = draft.autoTotals && draft.items.length > 0
    ? {
        calories: Math.round(recomputed.calories),
        protein_g: Math.round(recomputed.protein_g * 10) / 10,
        carbs_g: Math.round(recomputed.carbs_g * 10) / 10,
        fat_g: Math.round(recomputed.fat_g * 10) / 10,
      }
    : { calories: draft.calories, protein_g: draft.protein_g, carbs_g: draft.carbs_g, fat_g: draft.fat_g };

  function updateItem(i: number, patch: Partial<MealItem>) {
    setDraft({ ...draft, items: draft.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) });
  }
  function removeItem(i: number) {
    setDraft({ ...draft, items: draft.items.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>

      {draft.items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Items</Label>
            <span className="text-[10px] text-muted-foreground">Totals auto-update</span>
          </div>
          <div className="rounded-lg border divide-y bg-card">
            {draft.items.map((it, i) => (
              <div key={i} className="p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{it.name}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {it.portion ?? "1 serving"} · {Math.round(it.calories * it.quantity)} kcal
                  </div>
                </div>
                <div className="flex items-center rounded-full border">
                  <button
                    type="button"
                    onClick={() => updateItem(i, { quantity: Math.max(0.5, Math.round((it.quantity - 0.5) * 2) / 2) })}
                    className="h-7 w-7 grid place-items-center text-sm text-muted-foreground hover:text-foreground"
                    aria-label="Decrease"
                  >−</button>
                  <span className="px-1.5 text-xs tabular-nums w-8 text-center">{it.quantity % 1 === 0 ? it.quantity : it.quantity.toFixed(1)}</span>
                  <button
                    type="button"
                    onClick={() => updateItem(i, { quantity: Math.round((it.quantity + 0.5) * 2) / 2 })}
                    className="h-7 w-7 grid place-items-center text-sm text-muted-foreground hover:text-foreground"
                    aria-label="Increase"
                  >+</button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-muted-foreground hover:text-destructive p-1.5"
                  aria-label="Remove item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <Field label="kcal" value={totals.calories} onChange={(v) => setDraft({ ...draft, calories: v, autoTotals: false })} />
        <Field label="P (g)" value={totals.protein_g} onChange={(v) => setDraft({ ...draft, protein_g: v, autoTotals: false })} />
        <Field label="C (g)" value={totals.carbs_g} onChange={(v) => setDraft({ ...draft, carbs_g: v, autoTotals: false })} />
        <Field label="F (g)" value={totals.fat_g} onChange={(v) => setDraft({ ...draft, fat_g: v, autoTotals: false })} />
      </div>
    </div>
  );
}

function computeTotals(draft: Draft) {
  const useAuto = draft.autoTotals && draft.items.length > 0;
  const totals = useAuto
    ? draft.items.reduce(
        (acc, it) => {
          acc.calories += it.calories * it.quantity;
          acc.protein_g += it.protein_g * it.quantity;
          acc.carbs_g += it.carbs_g * it.quantity;
          acc.fat_g += it.fat_g * it.quantity;
          return acc;
        },
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      )
    : { calories: draft.calories, protein_g: draft.protein_g, carbs_g: draft.carbs_g, fat_g: draft.fat_g };
  return {
    calories: Math.round(totals.calories),
    protein_g: Math.round(totals.protein_g * 10) / 10,
    carbs_g: Math.round(totals.carbs_g * 10) / 10,
    fat_g: Math.round(totals.fat_g * 10) / 10,
  };
}

/* ---------------- Edit Meal ---------------- */

function EditMealDialog({ meal, onClose, onSaved }: { meal: Meal; onClose: () => void; onSaved: () => void }) {
  const items = normalizeItems(meal.items);
  const [draft, setDraft] = useState<Draft>({
    name: meal.name,
    description: meal.description ?? "",
    calories: meal.calories,
    protein_g: Number(meal.protein_g) || 0,
    carbs_g: Number(meal.carbs_g) || 0,
    fat_g: Number(meal.fat_g) || 0,
    items,
    autoTotals: items.length > 0,
  });
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFnTanstack(updateMeal);

  async function save() {
    if (saving || !draft.name) return;
    setSaving(true);
    try {
      const totals = computeTotals(draft);
      await updateFn({
        data: {
          id: meal.id,
          name: draft.name,
          description: draft.description,
          items: draft.items,
          ...totals,
        },
      });
      toast.success("Updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!saving && !o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit meal</DialogTitle>
        </DialogHeader>
        <MealEditorForm draft={draft} setDraft={setDraft} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !draft.name}>
            {saving ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>) : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Add Meal Flow ---------------- */

function AddMealButton({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const analyzeFn = useServerFnTanstack(analyzeMealImage);
  const addFn = useServerFnTanstack(addMeal);

  async function handleFile(file: File) {
    setAnalyzing(true);
    setDraft(null);
    try {
      const dataUrl = await downscaleImage(file, 1024, 0.8);
      setPreviewUrl(dataUrl);
      setOpen(true);
      const result: any = await analyzeFn({ data: { imageDataUrl: dataUrl } });
      const items = normalizeItems(result.items);
      setDraft({
        name: result.name,
        description: result.description,
        calories: result.calories,
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        items,
        autoTotals: items.length > 0,
      });
    } catch (e: any) {
      toast.error(e.message ?? "Analysis failed");
      setOpen(false);
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const now = new Date();
      const totals = computeTotals(draft);
      await addFn({
        data: {
          name: draft.name,
          description: draft.description,
          items: draft.items,
          ...totals,
          category: categoryFromDate(now),
          eaten_at: now.toISOString(),
        },
      });
      toast.success(`Logged ${totals.calories} kcal`);
      setOpen(false);
      setDraft(null);
      setPreviewUrl(null);
      onAdded();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openManual() {
    setPreviewUrl(null);
    setDraft({ name: "", description: "", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, items: [], autoTotals: false });
    setOpen(true);
  }

  const photoBusy = analyzing || saving;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={() => { if (!photoBusy) fileInput.current?.click(); }}
          disabled={photoBusy}
          className="h-12 rounded-xl"
        >
          {analyzing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}
          {analyzing ? "Analyzing…" : "Photo"}
        </Button>
        <Button variant="outline" onClick={openManual} className="h-12 rounded-xl">
          <Plus className="h-4 w-4 mr-2" /> Manual
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      <Dialog open={open} onOpenChange={(o) => { if (saving) return; setOpen(o); if (!o) { setDraft(null); setPreviewUrl(null); }}}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log meal</DialogTitle>
          </DialogHeader>

          {previewUrl && (
            <div className="relative overflow-hidden rounded-lg border bg-muted aspect-video">
              <img src={previewUrl} alt="meal" className="h-full w-full object-cover" />
              {analyzing && (
                <div className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
                  </div>
                </div>
              )}
            </div>
          )}

          {draft && !analyzing && <MealEditorForm draft={draft} setDraft={setDraft} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={!draft || analyzing || saving || !draft?.name}>
              {saving ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>) : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-9 px-2 text-sm"
      />
    </div>
  );
}

/* ---------------- History ---------------- */

function HistoryView({ meals, maintenance, onChange }: { meals: Meal[]; maintenance: number | null; onChange: () => void }) {
  const [range, setRange] = useState<"7" | "30" | "all">("7");
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  const data = useMemo(() => {
    const buckets: Record<string, number> = {};
    if (range === "all") {
      if (meals.length === 0) return [];
      const sorted = [...meals].sort((a, b) => new Date(a.eaten_at).getTime() - new Date(b.eaten_at).getTime());
      const start = startOfDay(new Date(sorted[0].eaten_at)).getTime();
      const end = startOfDay(new Date()).getTime();
      for (let t = start; t <= end; t += 86400_000) {
        buckets[new Date(t).toISOString()] = 0;
      }
    } else {
      const days = Number(range);
      for (let i = days - 1; i >= 0; i--) {
        const d = startOfDay(new Date(Date.now() - i * 86400_000));
        buckets[d.toISOString()] = 0;
      }
    }
    meals.forEach((m) => {
      const k = startOfDay(new Date(m.eaten_at)).toISOString();
      if (k in buckets) buckets[k] += m.calories;
    });
    return Object.entries(buckets).map(([iso, kcal]) => ({
      label: fmtShort(new Date(iso)),
      kcal,
      iso,
    }));
  }, [meals, range]);

  const totalAvg = Math.round(data.reduce((s, d) => s + d.kcal, 0) / Math.max(1, data.length));

  const dayMeals = dayOpen
    ? meals.filter((m) => startOfDay(new Date(m.eaten_at)).toISOString() === dayOpen)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Avg / day</div>
          <div className="text-2xl font-semibold tabular-nums">{totalAvg} <span className="text-sm text-muted-foreground font-normal">kcal</span></div>
        </div>
        <div className="inline-flex rounded-lg border p-0.5 bg-muted">
          {(["7", "30", "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${range === r ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {r === "all" ? "All" : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} width={32} />
              <RTooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                cursor={{ fill: "var(--accent)" }}
              />
              <Bar dataKey="kcal" fill="var(--foreground)" radius={[4, 4, 0, 0]} />
              {maintenance != null && (
                <ReferenceLine
                  y={maintenance}
                  stroke="var(--primary)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: `Maintenance ${maintenance}`, position: "insideTopRight", fill: "var(--primary)", fontSize: 10 }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <ViewMoreButton label="Daily breakdown" count={data.length} onClick={() => setBreakdownOpen(true)} />

      <Sheet open={breakdownOpen} onOpenChange={setBreakdownOpen}>
        <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col rounded-t-2xl">
          <SheetHeader className="p-5 pb-3 shrink-0">
            <SheetTitle>Daily breakdown</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-8">
            <div className="rounded-xl border divide-y bg-card">
              {[...data].reverse().map((d) => (
                <button
                  key={d.iso}
                  onClick={() => setDayOpen(d.iso)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent transition-colors"
                >
                  <div className="text-sm">{fmtDay(new Date(d.iso))}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm tabular-nums">{d.kcal} <span className="text-muted-foreground">kcal</span></div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!dayOpen} onOpenChange={(o) => { if (!o) setDayOpen(null); }}>
        <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col rounded-t-2xl">
          <SheetHeader className="p-5 pb-3 shrink-0">
            <SheetTitle>{dayOpen ? fmtDay(new Date(dayOpen)) : ""}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2">
            {dayMeals.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                No meals logged.
              </div>
            ) : (
              dayMeals.map((m) => <MealRow key={m.id} meal={m} onChange={onChange} />)
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------------- Weight ---------------- */

function WeightView({ weights, maintenance, goalKg, meals, onChange }: { weights: Weight[]; maintenance: number | null; goalKg: number | null; meals: Meal[]; onChange: () => void }) {
  const [input, setInput] = useState("");
  const [range, setRange] = useState<"7" | "30" | "all">("30");
  const [historyOpen, setHistoryOpen] = useState(false);
  const addFn = useServerFnTanstack(addWeight);
  const delFn = useServerFnTanstack(deleteWeight);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (kg: number) => addFn({ data: { weight_kg: kg } }),
    onSuccess: () => { onChange(); setInput(""); toast.success("Logged"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onMutate: (id: string) => { setDeletingId(id); },
    onSettled: () => setDeletingId(null),
    onSuccess: () => { onChange(); toast.success("Removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (add.isPending) return;
    const n = Number(input);
    if (!n || n <= 0) return toast.error("Enter a valid weight");
    add.mutate(n);
  }

  const cutoff = range === "all" ? 0 : Date.now() - Number(range) * 86400_000;
  const filtered = weights.filter((w) => new Date(w.logged_at).getTime() >= cutoff);
  const chartData = filtered.map((w) => ({
    label: fmtShort(new Date(w.logged_at)),
    kg: Number(w.weight_kg),
    iso: w.logged_at,
  }));

  const latest = weights[weights.length - 1];
  const first = filtered[0];
  const delta = latest && first ? (Number(latest.weight_kg) - Number(first.weight_kg)) : 0;

  // Goal projection: avg cal intake over last 14d vs maintenance
  const projection = useMemo(() => {
    if (!latest || goalKg == null || maintenance == null) return null;
    const currentKg = Number(latest.weight_kg);
    const diffKg = currentKg - goalKg;
    if (Math.abs(diffKg) < 0.05) return { reached: true, days: 0, deficit: 0, avgIntake: maintenance };
    const days = 14;
    const since = Date.now() - days * 86400_000;
    const buckets: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = startOfDay(new Date(Date.now() - i * 86400_000)).toISOString();
      buckets[d] = 0;
    }
    meals.forEach((m) => {
      const t = new Date(m.eaten_at).getTime();
      if (t < since) return;
      const k = startOfDay(new Date(m.eaten_at)).toISOString();
      if (k in buckets) buckets[k] += m.calories || 0;
    });
    const vals = Object.values(buckets);
    const avgIntake = vals.reduce((s, v) => s + v, 0) / vals.length;
    const deficit = maintenance - avgIntake; // +ve = losing
    const needLose = diffKg > 0; // need to lose
    const effective = needLose ? deficit : -deficit; // kcal/day toward goal
    if (effective <= 0) return { reached: false, days: null, deficit, avgIntake: Math.round(avgIntake), direction: needLose ? "lose" : "gain" as const };
    // 7700 kcal ≈ 1 kg
    const daysToGoal = Math.ceil((Math.abs(diffKg) * 7700) / effective);
    return { reached: false, days: daysToGoal, deficit, avgIntake: Math.round(avgIntake), direction: needLose ? "lose" : "gain" as const };
  }, [latest, goalKg, maintenance, meals]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Latest</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-4xl font-semibold tabular-nums">{latest ? Number(latest.weight_kg).toFixed(1) : "—"}</div>
          <div className="text-sm text-muted-foreground">kg</div>
        </div>
        {latest && (
          <div className="mt-1 text-xs text-muted-foreground">
            {delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg ${range === "all" ? "all time" : `over ${range}d`}`}
          </div>
        )}
      </div>

      {goalKg != null && latest && (
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Goal</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {goalKg.toFixed(1)} <span className="text-sm text-muted-foreground font-normal">kg</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">To go</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {(Number(latest.weight_kg) - goalKg).toFixed(1)}
                <span className="text-sm text-muted-foreground font-normal"> kg</span>
              </div>
            </div>
          </div>
          {projection && (
            <div className="mt-3 text-xs text-muted-foreground">
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

      <form onSubmit={submit} className="flex gap-2">
        <Input
          type="number"
          step="0.1"
          inputMode="decimal"
          placeholder="Weight in kg"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="h-12 rounded-xl"
        />
        <Button type="submit" disabled={add.isPending} className="h-12 rounded-xl px-5">
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>

      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Trend</div>
        <div className="inline-flex rounded-lg border p-0.5 bg-muted">
          {(["7", "30", "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${range === r ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {r === "all" ? "All" : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <div className="h-40">
          {chartData.length === 0 ? (
            <div className="grid place-items-center h-full text-sm text-muted-foreground">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} width={32} domain={["auto", "auto"]} />
                <RTooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                />
                <Line type="monotone" dataKey="kg" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 3, fill: "var(--foreground)" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <ViewMoreButton label="History" count={weights.length} onClick={() => setHistoryOpen(true)} />

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col rounded-t-2xl">
          <SheetHeader className="p-5 pb-3 shrink-0">
            <SheetTitle>Weight history</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-8">
            {weights.length === 0 ? (
              <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                No entries yet.
              </div>
            ) : (
              <div className="rounded-xl border divide-y bg-card">
                {[...weights].reverse().map((w) => {
                  const isDel = deletingId === w.id;
                  return (
                    <div key={w.id} className={`flex items-center justify-between px-4 py-3 transition-opacity ${isDel ? "opacity-50" : ""}`}>
                      <div className="text-sm">
                        {fmtDay(new Date(w.logged_at))}
                        <span className="text-muted-foreground"> · {fmtTime(new Date(w.logged_at))}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-sm tabular-nums">{Number(w.weight_kg).toFixed(1)} <span className="text-muted-foreground">kg</span></div>
                        <button
                          onClick={() => { if (!isDel) del.mutate(w.id); }}
                          disabled={isDel}
                          aria-label="Delete entry"
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors p-2 -m-1"
                        >
                          {isDel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
