import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn as useServerFnTanstack } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { analyzeMealImage } from "@/lib/ai.functions";
import { addMeal, listMeals, deleteMeal } from "@/lib/meals.functions";
import { addWeight, listWeights, deleteWeight } from "@/lib/weights.functions";
import { categoryFromDate, downscaleImage, type MealCategory } from "@/lib/meal-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import { Camera, Plus, Trash2, LogOut, Loader2, ImageIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({ meta: [{ title: "Trace — Food & Weight" }] }),
  component: AppPage,
});

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

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtDay(d: Date) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function fmtTime(d: Date) { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function fmtShort(d: Date) { return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }); }

function AppPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listMealsFn = useServerFnTanstack(listMeals);
  const listWeightsFn = useServerFnTanstack(listWeights);

  const mealsQ = useQuery({
    queryKey: ["meals"],
    queryFn: () => listMealsFn({ data: {} }) as Promise<Meal[]>,
  });
  const weightsQ = useQuery({
    queryKey: ["weights"],
    queryFn: () => listWeightsFn({ data: {} }) as Promise<Weight[]>,
  });

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-xl px-5 h-14 flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">Trace</h1>
          <button onClick={signOut} className="text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-5 pb-32 pt-4">
        <Tabs defaultValue="today" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-muted rounded-lg">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="weight">Weight</TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="mt-6">
            <TodayView meals={mealsQ.data ?? []} loading={mealsQ.isLoading} onChange={() => qc.invalidateQueries({ queryKey: ["meals"] })} />
          </TabsContent>
          <TabsContent value="history" className="mt-6">
            <HistoryView meals={mealsQ.data ?? []} />
          </TabsContent>
          <TabsContent value="weight" className="mt-6">
            <WeightView weights={weightsQ.data ?? []} onChange={() => qc.invalidateQueries({ queryKey: ["weights"] })} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* ---------------- Today ---------------- */

function TodayView({ meals, loading, onChange }: { meals: Meal[]; loading: boolean; onChange: () => void }) {
  const today = startOfDay(new Date());
  const todays = meals.filter((m) => startOfDay(new Date(m.eaten_at)).getTime() === today.getTime());
  const total = todays.reduce((s, m) => s + (m.calories || 0), 0);
  const protein = todays.reduce((s, m) => s + (Number(m.protein_g) || 0), 0);
  const carbs = todays.reduce((s, m) => s + (Number(m.carbs_g) || 0), 0);
  const fat = todays.reduce((s, m) => s + (Number(m.fat_g) || 0), 0);

  const grouped: Record<MealCategory, Meal[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
  todays.forEach((m) => grouped[m.category as MealCategory]?.push(m));

  return (
    <div className="space-y-6">
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

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
      ) : todays.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          No meals logged today.
        </div>
      ) : (
        <div className="space-y-5">
          {(["breakfast", "lunch", "dinner", "snack"] as MealCategory[]).map((cat) =>
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
          )}
        </div>
      )}
    </div>
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
  const del = useMutation({
    mutationFn: () => delFn({ data: { id: meal.id } }),
    onSuccess: () => { onChange(); toast.success("Removed"); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-medium truncate">{meal.name}</div>
          <div className="text-sm tabular-nums shrink-0">{meal.calories} kcal</div>
        </div>
        {meal.description && <div className="text-xs text-muted-foreground truncate">{meal.description}</div>}
        <div className="mt-1 text-[11px] text-muted-foreground">{fmtTime(new Date(meal.eaten_at))}</div>
      </div>
      <button onClick={() => del.mutate()} className="text-muted-foreground hover:text-destructive transition-colors p-1">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ---------------- Add Meal Flow ---------------- */

function AddMealButton({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string; description: string; calories: number;
    protein_g: number; carbs_g: number; fat_g: number; items: any[];
  } | null>(null);

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
      setDraft({
        name: result.name,
        description: result.description,
        calories: result.calories,
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        items: result.items,
      });
    } catch (e: any) {
      toast.error(e.message ?? "Analysis failed");
      setOpen(false);
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    if (!draft) return;
    try {
      const now = new Date();
      await addFn({
        data: {
          ...draft,
          category: categoryFromDate(now),
          eaten_at: now.toISOString(),
        },
      });
      toast.success(`Logged ${draft.calories} kcal`);
      setOpen(false);
      setDraft(null);
      setPreviewUrl(null);
      onAdded();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function openManual() {
    setPreviewUrl(null);
    setDraft({ name: "", description: "", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, items: [] });
    setOpen(true);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={() => fileInput.current?.click()}
          className="h-12 rounded-xl"
        >
          <Camera className="h-4 w-4 mr-2" /> Photo
        </Button>
        <Button variant="outline" onClick={openManual} className="h-12 rounded-xl">
          <Plus className="h-4 w-4 mr-2" /> Manual
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setDraft(null); setPreviewUrl(null); }}}>
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

          {draft && !analyzing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Field label="kcal" value={draft.calories} onChange={(v) => setDraft({ ...draft, calories: v })} />
                <Field label="P (g)" value={draft.protein_g} onChange={(v) => setDraft({ ...draft, protein_g: v })} />
                <Field label="C (g)" value={draft.carbs_g} onChange={(v) => setDraft({ ...draft, carbs_g: v })} />
                <Field label="F (g)" value={draft.fat_g} onChange={(v) => setDraft({ ...draft, fat_g: v })} />
              </div>
              {draft.items && draft.items.length > 0 && (
                <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
                  {draft.items.map((it: any, i: number) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="truncate">{it.name}{it.portion ? ` · ${it.portion}` : ""}</span>
                      <span className="tabular-nums text-muted-foreground">{it.calories} kcal</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!draft || analyzing || !draft.name || draft.calories <= 0}>
              Save
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

function HistoryView({ meals }: { meals: Meal[] }) {
  const [range, setRange] = useState<"7" | "30">("7");
  const days = Number(range);

  const data = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = startOfDay(new Date(Date.now() - i * 86400_000));
      buckets[d.toISOString()] = 0;
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
  }, [meals, days]);

  const totalAvg = Math.round(data.reduce((s, d) => s + d.kcal, 0) / Math.max(1, data.length));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Avg / day</div>
          <div className="text-2xl font-semibold tabular-nums">{totalAvg} <span className="text-sm text-muted-foreground font-normal">kcal</span></div>
        </div>
        <div className="inline-flex rounded-lg border p-0.5 bg-muted">
          {(["7", "30"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${range === r ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {r}d
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
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Daily breakdown</div>
        <div className="rounded-xl border divide-y bg-card">
          {[...data].reverse().map((d) => (
            <div key={d.iso} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm">{fmtDay(new Date(d.iso))}</div>
              <div className="text-sm tabular-nums">{d.kcal} <span className="text-muted-foreground">kcal</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Weight ---------------- */

function WeightView({ weights, onChange }: { weights: Weight[]; onChange: () => void }) {
  const [input, setInput] = useState("");
  const [range, setRange] = useState<"7" | "30" | "180">("30");
  const addFn = useServerFnTanstack(addWeight);
  const delFn = useServerFnTanstack(deleteWeight);

  const add = useMutation({
    mutationFn: (kg: number) => addFn({ data: { weight_kg: kg } }),
    onSuccess: () => { onChange(); setInput(""); toast.success("Logged"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { onChange(); toast.success("Removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(input);
    if (!n || n <= 0) return toast.error("Enter a valid weight");
    add.mutate(n);
  }

  const days = Number(range);
  const cutoff = Date.now() - days * 86400_000;
  const filtered = weights.filter((w) => new Date(w.logged_at).getTime() >= cutoff);
  const chartData = filtered.map((w) => ({
    label: fmtShort(new Date(w.logged_at)),
    kg: Number(w.weight_kg),
    iso: w.logged_at,
  }));

  const latest = weights[weights.length - 1];
  const first = filtered[0];
  const delta = latest && first ? (Number(latest.weight_kg) - Number(first.weight_kg)) : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Latest</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="text-5xl font-semibold tabular-nums">{latest ? Number(latest.weight_kg).toFixed(1) : "—"}</div>
          <div className="text-sm text-muted-foreground">kg</div>
        </div>
        {latest && (
          <div className="mt-2 text-xs text-muted-foreground">
            {delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg over ${range}d`}
          </div>
        )}
      </div>

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
          <Plus className="h-4 w-4" />
        </Button>
      </form>

      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Trend</div>
        <div className="inline-flex rounded-lg border p-0.5 bg-muted">
          {(["7", "30", "180"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${range === r ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {r === "180" ? "6m" : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <div className="h-48">
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

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">History</div>
        {weights.length === 0 ? (
          <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            No entries yet.
          </div>
        ) : (
          <div className="rounded-xl border divide-y bg-card">
            {[...weights].reverse().map((w) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-3">
                <div className="text-sm">
                  {fmtDay(new Date(w.logged_at))}
                  <span className="text-muted-foreground"> · {fmtTime(new Date(w.logged_at))}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm tabular-nums">{Number(w.weight_kg).toFixed(1)} <span className="text-muted-foreground">kg</span></div>
                  <button onClick={() => del.mutate(w.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
