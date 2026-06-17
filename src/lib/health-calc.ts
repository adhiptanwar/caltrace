export type ActivityLevel = "sedentary" | "light" | "moderate" | "heavy" | "athlete";

export const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; multiplier: number }[] = [
  { value: "sedentary", label: "Sedentary (office job)", multiplier: 1.2 },
  { value: "light", label: "Light Exercise (1-2 days/week)", multiplier: 1.375 },
  { value: "moderate", label: "Moderate Exercise (3-5 days/week)", multiplier: 1.55 },
  { value: "heavy", label: "Heavy Exercise (6-7 days/week)", multiplier: 1.725 },
  { value: "athlete", label: "Athlete (2x per day)", multiplier: 1.9 },
];

export function activityMultiplier(level: ActivityLevel | null | undefined): number {
  return ACTIVITY_OPTIONS.find((o) => o.value === level)?.multiplier ?? 1.2;
}

export function ageFromBirthDate(birth: string | null | undefined): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export function calcBMR(opts: {
  gender: "male" | "female" | null | undefined;
  weight_kg: number | null | undefined;
  height_cm: number | null | undefined;
  age: number | null | undefined;
}): number | null {
  const { gender, weight_kg, height_cm, age } = opts;
  if (!gender || !weight_kg || !height_cm || !age) return null;
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return Math.round(gender === "male" ? base + 5 : base - 161);
}

export function calcTDEE(bmr: number | null, level: ActivityLevel | null | undefined): number | null {
  if (bmr == null) return null;
  return Math.round(bmr * activityMultiplier(level));
}

export function calcBMI(weight_kg: number | null | undefined, height_cm: number | null | undefined): number | null {
  if (!weight_kg || !height_cm) return null;
  const m = height_cm / 100;
  return Math.round((weight_kg / (m * m)) * 10) / 10;
}

export function bmiCategory(bmi: number | null): string {
  if (bmi == null) return "—";
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Healthy weight";
  if (bmi < 30) return "Overweight";
  return "Obese";
}

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return { ft, inch };
}
