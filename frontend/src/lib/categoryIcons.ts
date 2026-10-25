/** Category icon + colour choices (kept out of the component file so Fast Refresh works). */

import {
  Baby,
  Banknote,
  BedDouble,
  Beer,
  Bike,
  BookOpen,
  BriefcaseBusiness,
  Bus,
  CalendarClock,
  Car,
  Clapperboard,
  Coffee,
  Droplet,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  Headphones,
  HeartHandshake,
  House,
  Landmark,
  Lightbulb,
  PawPrint,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Receipt,
  Scissors,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Stethoscope,
  Tag,
  TrainFront,
  TrendingUp,
  Tv,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The icons a category can use. A hand-picked set rather than all ~3,800 lucide icons,
 * which would add hundreds of KB to the bundle. Unknown names fall back to Tag.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  UtensilsCrossed, ShoppingBasket, Fuel, House, Lightbulb, ShoppingBag, Plane, CalendarClock,
  Stethoscope, Clapperboard, BriefcaseBusiness, HeartHandshake, Tag,
  Car, Bus, TrainFront, Bike, Coffee, Pizza, Beer, Wifi, Smartphone, Tv, Zap, Droplet,
  Gift, GraduationCap, BookOpen, Baby, PawPrint, Dumbbell, Pill, Shirt, Scissors, Wrench,
  BedDouble, Headphones, Gamepad2, Sparkles, Shield, Landmark, PiggyBank, TrendingUp,
  Receipt, Banknote, Wallet, HandCoins,
};

/** Colours offered for custom categories (same family as the seeded ones). */
export const CATEGORY_COLORS = [
  "#ea580c", "#ca8a04", "#16a34a", "#059669", "#0d9488", "#0284c7",
  "#1f4fd1", "#4f46e5", "#7c3aed", "#9333ea", "#db2777", "#e11d48", "#dc2626", "#64748b",
];
