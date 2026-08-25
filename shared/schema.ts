import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// An analysis run: user submits a client URL + intake info; we produce a strategy + SOW.
export const analyses = sqliteTable("analyses", {
  id: text("id").primaryKey(), // uuid
  clientName: text("client_name").notNull(),
  clientUrl: text("client_url").notNull(),
  industry: text("industry"),
  revenueBand: text("revenue_band"),
  goals: text("goals"), // free-text goals
  budgetBand: text("budget_band"),
  notes: text("notes"),
  status: text("status").notNull(), // queued | extracting | competitors | strategy | sow | done | error
  progress: integer("progress").notNull().default(0), // 0-100
  currentStep: text("current_step"), // label of currently-running step
  errorMessage: text("error_message"),
  // Result payloads (JSON strings)
  extraction: text("extraction"), // { title, description, positioning, valueProps, offerings, evidence, techStack, seoNotes }
  competitors: text("competitors"), // [{ name, url, positioning, strengths, weaknesses, hookIdeas }]
  strategy: text("strategy"), // { icp, positioningGaps, aeoRecommendations, contentPillars, channelMix, quickWins, ninetyDayPlan }
  sow: text("sow"), // { engagementSummary, phases:[{name,weeks,deliverables,outcomes}], team, priceTiers:[{name,monthly,inclusions}], termsNotes }
  createdAt: integer("created_at").notNull(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).pick({
  clientName: true,
  clientUrl: true,
  industry: true,
  revenueBand: true,
  goals: true,
  budgetBand: true,
  notes: true,
});

// Extend with validation
export const intakeSchema = insertAnalysisSchema.extend({
  clientName: z.string().min(2, "Client name required"),
  clientUrl: z.string().url("Must be a valid URL, e.g. https://example.com"),
  industry: z.string().optional(),
  revenueBand: z.string().optional(),
  goals: z.string().optional(),
  budgetBand: z.string().optional(),
  notes: z.string().optional(),
});

export type InsertAnalysis = z.infer<typeof intakeSchema>;
export type Analysis = typeof analyses.$inferSelect;

// Typed shapes for parsed result JSON (frontend-friendly)
export type Extraction = {
  title: string;
  description: string;
  positioningStatement: string;
  valueProps: string[];
  offerings: string[];
  targetAudience: string;
  evidenceElements: string[];
  ctaAudit: string;
  seoNotes: string;
  aeoReadinessScore: number; // 0-100
  aeoReadinessNotes: string;
};

export type Competitor = {
  name: string;
  url: string;
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  hookIdeas: string[];
};

export type Strategy = {
  icp: {
    summary: string;
    firmographics: string[];
    painPoints: string[];
    buyingTriggers: string[];
  };
  positioningGaps: string[];
  messagingRecommendations: string[];
  aeoRecommendations: string[];
  contentPillars: { name: string; description: string; sampleTitles: string[] }[];
  channelMix: { channel: string; role: string; priority: "High" | "Medium" | "Low" }[];
  quickWins: string[];
  ninetyDayPlan: { phase: string; weeks: string; focus: string; outcomes: string[] }[];
};

export type SOW = {
  engagementSummary: string;
  phases: { name: string; weeks: string; deliverables: string[]; outcomes: string[] }[];
  team: string[];
  priceTiers: { name: string; monthly: string; inclusions: string[]; bestFor: string }[];
  termsNotes: string[];
};

// ============================================================
// Phase 2: Content Engine
// ============================================================

// A content plan is a set of content commitments tied to a single analysis.
// One plan per analysis (for now). Contains the 12-week blog calendar, ad brief,
// social cadence, and landing-page slate.
export const contentPlans = sqliteTable("content_plans", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull(),
  status: text("status").notNull(), // queued | generating | ready | error
  progress: integer("progress").notNull().default(0),
  currentStep: text("current_step"),
  errorMessage: text("error_message"),
  // High-level plan JSON (calendar, ad brief, social cadence, landing-page slate)
  planJson: text("plan_json"),
  createdAt: integer("created_at").notNull(),
});

// A single content piece — blog, paid ad, social post, or landing page.
// Rows are created for every calendar entry when the plan is generated.
// Draft copy is filled in lazily via POST /content-pieces/:id/draft.
export const contentPieces = sqliteTable("content_pieces", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  analysisId: text("analysis_id").notNull(),
  channel: text("channel").notNull(), // blog | linkedin | instagram | x | meta_ad | linkedin_ad | landing_page
  title: text("title").notNull(),
  weekNumber: integer("week_number"),
  scheduledDate: text("scheduled_date"),
  pillar: text("pillar"),
  targetQuery: text("target_query"), // AEO buyer question
  briefJson: text("brief_json"), // channel-specific brief (angle, keywords, cluster, cta)
  draftJson: text("draft_json"), // channel-specific draft payload (null until drafted)
  status: text("status").notNull(), // planned | drafting | drafted | approved | rejected | error
  reviewNotes: text("review_notes"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ContentPlan = typeof contentPlans.$inferSelect;
export type ContentPiece = typeof contentPieces.$inferSelect;

export type Channel =
  | "blog"
  | "linkedin"
  | "instagram"
  | "x"
  | "meta_ad"
  | "linkedin_ad"
  | "landing_page";

// The top-level plan payload we store in content_plans.planJson
export type ContentPlanPayload = {
  summary: string;
  contentPillars: { name: string; description: string }[];
  blogCalendar: {
    weekNumber: number;
    weekOf: string; // ISO date of the Monday
    posts: {
      title: string;
      pillar: string;
      targetQuery: string; // AEO buyer question
      angle: string;
      keywords: string[];
      scheduledDate: string;
      // Editorial brief (Option D) — makes each post ready for a writer
      editorialBrief?: {
        readerQuestion: string; // what the target reader is really asking
        angleSummary: string; // 2 sentences: why THIS client, not generic
        primaryKeyword: string;
        aeoQuery: string; // the AEO-shaped question this post ranks for
      };
    }[];
  }[];
  socialCadence: {
    channel: "linkedin" | "instagram" | "x";
    postsPerWeek: number;
    starterPosts: { title: string; hook: string; targetQuery: string; angle: string }[];
  }[];
  adBrief: {
    channel: "meta_ad" | "linkedin_ad";
    audience: string;
    creatives: { title: string; angle: string; primaryClaim: string; cta: string }[];
  }[];
  // Hero examples — one FULL sample per channel, demonstrating quality bar
  heroMetaAd?: {
    headline: string; // 40 char max
    primaryText: string; // 125 char sweet spot
    description: string; // 30 char max
    cta: string; // one of approved CTAs
    visualConcept: string; // 1-2 sentence description of the creative
  };
  heroLinkedInAd?: {
    introText: string; // 150 char sweet spot
    headline: string; // 70 char max
    description: string; // 100 char max
    cta: string;
    visualConcept: string;
  };
  heroColdEmail?: {
    subjectLineA: string;
    subjectLineB: string;
    touch1: { day: number; body: string }; // day 0
    touch2: { day: number; body: string }; // day 3-4
    touch3: { day: number; body: string }; // day 7-8, breakup email
    icpTarget: string; // who this sequence targets
  };
  landingPages: {
    title: string;
    slug: string;
    serviceOrProduct: string;
    targetQuery: string;
    outline: string[];
  }[];
  roiProjections?: RoiProjections;
};

// -------- ROI Projections --------
// Conservative 12-month projections. All assumptions are AI-inferred from the
// client's analysis (industry, ICP, deal size signals). Confidence tier flags
// how much we trust each assumption so the UI can show "benchmark" vs "est."
export type RoiAssumptions = {
  // Deal economics (client-specific)
  avgDealSize: number;          // USD, one-time or ACV
  dealType: "one-time" | "acv";
  grossMargin: number;          // 0.0 – 1.0
  salesCycleDays: number;

  // Conversion rates (each stage of funnel)
  visitorToLeadRate: number;    // 0.0 – 1.0 (typically 0.005 – 0.03)
  leadToMqlRate: number;        // 0.0 – 1.0
  mqlToSqlRate: number;         // 0.0 – 1.0
  sqlToWonRate: number;         // 0.0 – 1.0

  // Traffic assumptions (per SEO/AEO post, at maturity)
  monthlyVisitorsPerPost: number;    // conservative avg once ranked
  monthsToRank: number;              // typical time to hit mature traffic
  contentDecayFactor: number;        // 0.85–0.95 (traffic held after decay)

  // Program costs (Brex-specific)
  programCost12Mo: number;      // Total Brex engagement cost over 12 months
  paidCacBaseline: number;      // What a comparable lead costs via paid media

  // Rationale text — shown to user for credibility
  rationale: {
    dealSize: string;
    conversionRates: string;
    trafficRamp: string;
    programCost: string;
  };
};

export type RoiOutcomes = {
  // Traffic
  month12MonthlyVisitors: number;
  month12CumulativeVisitors: number;

  // Funnel (12-month totals)
  totalLeads: number;
  totalMqls: number;
  totalSqls: number;
  totalClosedWon: number;
  totalRevenue: number;
  totalGrossProfit: number;

  // Efficiency
  brexCostPerLead: number;
  brexCostPerSql: number;
  paidEquivalentCost: number;   // What paid media would cost for same leads
  savingsVsPaid: number;        // paidEquivalent – programCost
  paybackMonth: number | null;  // Month cumulative gross profit >= programCost, null if not within 12mo
  roiMultiple: number;          // totalGrossProfit / programCost
};

export type RoiMonthlyPoint = {
  month: number;                // 1–12
  postsLive: number;
  monthlyVisitors: number;
  monthlyLeads: number;
  monthlyMqls: number;
  monthlySqls: number;
  monthlyClosedWon: number;
  monthlyRevenue: number;
  cumulativeRevenue: number;
  cumulativeGrossProfit: number;
};

export type RoiProjections = {
  assumptions: RoiAssumptions;
  outcomes: RoiOutcomes;
  monthlyProjection: RoiMonthlyPoint[]; // 12 rows
  disclaimer: string;
};

// Channel-specific draft shapes
export type BlogDraft = {
  h1: string;
  keyTakeaways: string[];
  quickAnswer: string; // 40-60 word direct answer
  sections: { h2: string; body: string }[];
  faqs: { q: string; a: string }[];
  references: { title: string; url: string }[];
  fiftyWordExcerpt: string;
  schemaSuggestions: string[];
  wordCount: number;
};

export type SocialDraft = {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  imagePrompt?: string;
};

export type AdDraft = {
  headline: string; // ≤ 40 chars
  primaryText: string; // 90-125 words
  descriptions: string[];
  cta: string;
  audienceTargeting: string;
  imagePrompt: string;
};

export type LandingPageDraft = {
  h1: string;
  subhead: string;
  keyTakeaways: string[];
  quickAnswer: string;
  sections: { h2: string; body: string }[];
  faqs: { q: string; a: string }[];
  proofPoints: string[];
  primaryCta: string;
  secondaryCta: string;
  schemaSuggestions: string[];
};
