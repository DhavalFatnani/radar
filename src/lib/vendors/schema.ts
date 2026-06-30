import { z } from "zod";

export const vendorStubSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
});
export type VendorStubInput = z.infer<typeof vendorStubSchema>;

export type VendorListItem = { vendorId: string; name: string };

export type VendorConstraints = {
  minProjectSize?: string;
  maxProjectSize?: string;
  geographies?: string[];
  capacity?: string;
  currentLoad?: string;
  workingCapitalLimit?: string;
  leadTimes?: string;
};

export type InterviewHistoryEntry = {
  at: string;
  actor: "operator";
  kind: "manual_edit";
  changed: string[];
  version: number;
};

export type VendorProfile = {
  vendorId: string;
  name: string;
  capabilities: string[];
  constraints: VendorConstraints | null;
  idealCustomer: string | null;
  knownGoodSignals: string | null;
  differentiators: string | null;
  credibility: string | null;
  version: number;
  interviewHistory: InterviewHistoryEntry[];
};

// Parse a newline/comma-separated string (or an array) into a clean string list.
const stringList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[\n,]/)))
  .transform((arr) => arr.map((s) => s.trim()).filter(Boolean));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const constraintsSchema = z.object({
  minProjectSize: optionalText(200),
  maxProjectSize: optionalText(200),
  geographies: stringList.optional(),
  capacity: optionalText(200),
  currentLoad: optionalText(200),
  workingCapitalLimit: optionalText(200),
  leadTimes: optionalText(200),
});

export const vendorProfileSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required.").max(200, "Vendor name is too long."),
  capabilities: stringList,
  constraints: constraintsSchema,
  idealCustomer: optionalText(4000),
  knownGoodSignals: optionalText(4000),
  differentiators: optionalText(4000),
  credibility: optionalText(4000),
});
export type VendorProfileInput = z.infer<typeof vendorProfileSchema>;
