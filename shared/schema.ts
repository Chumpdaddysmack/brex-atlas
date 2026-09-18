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
  // Framework opt-ins (from intake form)
  includePestel: integer("include_pestel").default(0),   // 0/1
  includePorters: integer("include_porters").default(0), // 0/1
  includeCustomerInsights: integer("include_customer_insights").default(0), // 0/1
  // Underlying assumptions (JSON blob) — editable on intake AND analysis page
  assumptions: text("assumptions"),  // JSON string of Assumptions type
  status: text("status").notNull(), // queued | extracting | competitors | strategy | sow | frameworks | done | error
  progress: integer("progress").notNull().default(0), // 0-100
  currentStep: text("current_step"), // label of currently-running step
  errorMessage: text("error_message"),
  // Result payloads (JSON strings)
  extraction: text("extraction"),
  competitors: text("competitors"),
  strategy: text("strategy"),
  sow: text("sow"),
  // Strategic frameworks — added Sep 2026
  swot: text("swot"),         // SwotAnalysis
  pestel: text("pestel"),     // PestelAnalysis (only if includePestel)
  porters: text("porters"),   // PortersFiveForces (only if includePorters)
  customerInsights: text("customer_insights"),  // CustomerInsights (only if includeCustomerInsights)
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
  includePestel: true,
  includeCustomerInsights: true,
  includePorters: true,
  assumptions: true,
});

// Underlying Assumptions — what the analysis is grounded in. Every field optional so
// the intake can accept partials; each field is either a plain USD number, a number,
// a short string, or a small enum. Persisted as JSON in analyses.assumptions.
export const assumptionsSchema = z.object({
  currentAnnualRevenue: z.number().positive().nullable().optional(),   // USD
  currentMarketingBudget: z.number().positive().nullable().optional(), // USD/yr
  grossMarginPct: z.number().min(0).max(100).nullable().optional(),    // 0-100
  revenueGrowthTargetPct: z.number().min(0).nullable().optional(),     // % lift next 12 mo
  topCompetitors: z.string().max(500).nullable().optional(),           // comma-separated
  preferredTier: z.enum(["advisor", "strategist", "fractional", "unknown"]).nullable().optional(),
});
export type Assumptions = z.infer<typeof assumptionsSchema>;

// Extend with validation
export const intakeSchema = insertAnalysisSchema.extend({
  clientName: z.string().min(2, "Client name required"),
  clientUrl: z.string().url("Must be a valid URL, e.g. https://example.com"),
  industry: z.string().optional(),
  revenueBand: z.string().optional(),
  goals: z.string().optional(),
  budgetBand: z.string().optional(),
  notes: z.string().optional(),
  // Accept booleans in the intake payload; storage/DB uses 0/1.
  includePestel: z.union([z.boolean(), z.number()]).optional().default(false),
  includeCustomerInsights: z.union([z.boolean(), z.number()]).optional().default(false),
  includePorters: z.union([z.boolean(), z.number()]).optional().default(false),
  // Assumptions can come in as either a parsed object OR a JSON string (client sends object; DB stores string)
  assumptions: z.union([z.string(), assumptionsSchema]).nullable().optional(),
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
  ninetyDayPlan: {
    phase: string;
    weeks: string;
    focus: string;
    outcomes: string[];
    rationale?: StrategicRationale;
  }[];
};

export type SOW = {
  engagementSummary: string;
  phases: {
    name: string;
    weeks: string;
    deliverables: string[];
    outcomes: string[];
    rationale?: StrategicRationale;
  }[];
  team: string[];
  priceTiers: { name: string; monthly: string; inclusions: string[]; bestFor: string }[];
  termsNotes: string[];
};

// ============================================================
// Strategic Frameworks — SWOT, PESTEL, Porter's Five Forces
// Added Sep 2026. Feed strategic-rationale blocks on the 90-day plan
// and SOW recommendations.
// ============================================================

// Source citation used by PESTEL + Porter's factors.
export type FrameworkSource = {
  title: string;
  url: string;
  publisher?: string;
  date?: string;   // ISO-ish ("2026-03") or free-text ("March 2026")
};

// SWOT — synthesized from the extraction + competitor set. Fast, cheap.
// Each item has a stable id (e.g. "S1", "W2") so recommendations can cite it.
export type SwotItem = {
  id: string;              // "S1" | "W2" | "O3" | "T1"
  title: string;           // short label, ~5-8 words
  evidence: string;        // 1-2 sentences grounded in the extraction/competitors
};

export type SwotAnalysis = {
  strengths: SwotItem[];   // 3-5
  weaknesses: SwotItem[];  // 3-5
  opportunities: SwotItem[]; // 3-5
  threats: SwotItem[];     // 3-5
  summary: string;         // 2-3 sentence strategic read
  industry: string;        // inferred if not user-supplied
};

// PESTEL — external macro factors. Each factor has 2-4 findings with citations.
export type PestelFactor = "political" | "economic" | "social" | "technological" | "environmental" | "legal";

export type PestelFinding = {
  id: string;              // e.g. "PESTEL-Tech-1"
  factor: PestelFactor;
  insight: string;         // 1-2 sentences, industry-specific
  impact: "positive" | "negative" | "neutral";
  timeHorizon: "near" | "mid" | "long"; // <12mo | 12-36mo | 3yr+
  sources: FrameworkSource[];
};

export type PestelAnalysis = {
  industry: string;
  findings: PestelFinding[]; // typically 12-20 total across 6 factors
  summary: string;
};

// Porter's Five Forces — competitive structure analysis.
export type PortersForceName =
  | "rivalry"
  | "newEntrants"
  | "substitutes"
  | "buyerPower"
  | "supplierPower";

export type PortersForce = {
  id: string;              // e.g. "P5F-Rivalry"
  force: PortersForceName;
  intensity: "low" | "medium" | "high";
  rationale: string;       // 2-4 sentences
  drivers: string[];       // 2-4 bullet drivers behind the intensity
  sources: FrameworkSource[];
};

export type PortersFiveForces = {
  industry: string;
  forces: PortersForce[];  // exactly 5, in canonical order
  overallStructure: string; // 2-3 sentence read on attractiveness
  summary: string;
};

// ============================================================
// Customer Insights — deep buyer intelligence pack.
// Added Sep 2026 (Option A upgrade). Replaces the shallow strategy.icp
// fields when opted in: strategy.icp becomes a 2-3 line summary drawn from
// this payload. 12 sub-analyses grouped into 4 panels:
//   A. Who they are      — persona, psychographics, sociotype
//   B. What hurts / hire  — pain points, JTBD, voice-of-customer
//   C. Will they buy      — Would-They-Buy, Mom Test, buying signals
//   D. How the deal closes — decision committee, objections, journey stages
// ============================================================

// Panel A
export type CIPersona = {
  name: string;                                   // e.g. "Liam Hawthorne"
  role: string;                                   // "ERP Project Manager"
  seniority: "ic" | "manager" | "director" | "vp" | "c-suite" | "owner";
  orgSize: string;                                // "50-500 employees"
  industry: string;
  authority: "decider" | "influencer" | "user" | "gatekeeper" | "champion";
  isPrimary: boolean;
};

export type CIPsychographics = {
  personalityType: string;                        // "Methodical"
  buyerType: string;                              // "Brand Loyalist"
  buyerStage: string;                             // "Early Adopter"
  userType: string;                               // "Power User"
  decisionStyle: "analytical" | "intuitive" | "consensus" | "directive";
  riskTolerance: "low" | "medium" | "high";
  informationDiet: string[];                      // sources they consume
  brandRelationship: "loyalist" | "switcher" | "evaluator" | "skeptic";
};

export type CISociotype = {
  archetype: string;                              // "ENTJ — Strategic Implementer"
  iAm: string;
  iCrave: string;
  butAlso: string;
  iStruggleWith: string;
  iConsume: string;
};

// Panel B
export type CIPainPoint = {
  rank: number;                                   // 1-5
  label: string;                                  // "Implementation Complexity"
  symptom: string;
  businessCost: string;
  currentWorkaround: string;
  ourLeverage: string;                            // how Brex/client solves it
};

export type CIJTBD = {
  situation: string;                              // "When {situation}"
  motivation: string;                             // "I want to {motivation}"
  outcome: string;                                // "so I can {outcome}"
  functionalJob: string;
  emotionalJob: string;
  socialJob: string;
};

export type CIVoiceOfCustomer = {
  quote: string;                                  // verbatim or paraphrased
  speaker: string;                                // "SaaS COO, 200-person co"
  source: string;                                 // "G2 review" | "LinkedIn" | "Representative language"
  sourceUrl?: string;                             // present when real search returned it
  isParaphrased: boolean;                         // true when fallback / representative
  theme: string;                                  // groups quotes
  supportsJTBD?: string;                          // ties back to JTBD situation line
  supportsPain?: string;                          // ties back to a pain-point label
};

// Panel C
export type CIWouldTheyBuySignal = {
  signal: string;                                 // "Prospect asks for pricing before demo"
  whatItMeans: string;
  strength: "weak" | "moderate" | "strong";
};

export type CIMomTestQuestion = {
  question: string;
  whyItWorks: string;
  antipattern: string;                            // the compliment-seeking version
};

export type CIBuyingSignal = {
  trigger: string;                                // "Hired a VP of Ops"
  category: "hiring" | "funding" | "tech-stack" | "leadership" | "content" | "competitor";
  urgency: "cold" | "warming" | "hot" | "in-market";
  action: string;                                 // outreach play to run
};

// Panel D
export type CIDecisionCommitteeRole = {
  role: string;                                   // "CFO"
  motivation: string;
  blocker: string;
  ourPlay: "champion" | "neutralize" | "educate" | "bypass";
  primaryObjection: string;
};

export type CIObjection = {
  objection: string;                              // "We already have an agency"
  frame: "price" | "risk" | "timing" | "fit" | "authority" | "status-quo";
  underlyingFear: string;
  reframe: string;                                // the language we use
  proofAsset: string;                             // case study, calculator, benchmark
};

export type CIJourneyStage = {
  stage: "unaware" | "aware" | "considering" | "deciding" | "deciding-with-us";
  mindset: string;
  primaryQuestion: string;
  channel: string;                                // "LinkedIn, industry podcasts"
  contentAsset: string;                           // "Growth Excavation Report"
  cta: string;
  exitCriterion: string;                          // what proves they moved on
};

export type CustomerInsights = {
  industry: string;
  // Panel A
  personas: CIPersona[];                          // 1-2
  psychographics: CIPsychographics;
  sociotype: CISociotype;
  // Panel B
  painPoints: CIPainPoint[];                      // 3-5
  jtbd: CIJTBD[];                                 // 3-5
  voiceOfCustomer: CIVoiceOfCustomer[];           // 6-10
  // Panel C
  wouldTheyBuySignals: CIWouldTheyBuySignal[];    // 5
  momTestQuestions: CIMomTestQuestion[];          // 5
  buyingSignals: CIBuyingSignal[];                // 5-8
  // Panel D
  decisionCommittee: CIDecisionCommitteeRole[];   // 3-7
  objections: CIObjection[];                      // 5
  journeyStages: CIJourneyStage[];                // exactly 5
  // Meta
  summary: string;                                // 2-3 sentence exec read — feeds strategy.icp.summary
  vocSources: FrameworkSource[];                  // aggregated sources from real search (empty when fallback)
  vocEvidenceMode: "real" | "paraphrased" | "mixed";
};

// Strategic rationale block — appended to 90-day plan items and SOW
// recommendations. Each rationale cites which framework finding(s) drove it.
export type StrategicRationale = {
  why: string;             // 1-2 sentences: WHY this recommendation, in plain english
  citations: string[];     // ids like ["S2", "T1", "PESTEL-Tech-1", "P5F-Rivalry"]
};

// Convenience bundle stored in a single JSON blob in analyses.strategy when
// rationale is baked into the 90-day plan / SOW. Optional — the client also
// composes rationale on-the-fly from the framework payloads.
export type PlanWithRationale = {
  ninetyDayPlan: {
    phase: string;
    weeks: string;
    focus: string;
    outcomes: string[];
    rationale?: StrategicRationale;
  }[];
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
      // Bidirectional linking to Site Architecture (assigned by cross-linker)
      targetPageSlug?: string;    // primary pillar page this post supports
      targetPageTitle?: string;   // convenience copy for UI/PDF display
    }[];
  }[];
  socialCadence: {
    channel: "linkedin" | "instagram" | "x";
    postsPerWeek: number;
    starterPosts: {
      title: string;
      hook: string;
      targetQuery: string;
      angle: string;
      targetPageSlug?: string;    // pillar page this social post references
      targetPageTitle?: string;
    }[];
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
  // SEO/GEO Site Architecture — 15-25 pillar + spoke pages with full briefs +
  // draft copy, plus bidirectional linking to blog posts and social content.
  sitemap?: SitemapPayload;
};

// -------- SEO/GEO Site Architecture --------
// Full sitemap tree with pillar + spoke pages, local-SEO section (city hub +
// location pages), draft copy for every page, and a bidirectional linking
// map to the content plan's blog posts and social starters.

export type SitemapPageType =
  | "home"
  | "about"
  | "service"       // core service pillar
  | "solution"      // industry/use-case landing
  | "why-us"        // differentiators, USP proof
  | "pricing"       // if applicable
  | "case-study"    // proof/social-proof pages
  | "resources"     // guides / whitepapers hub
  | "faq"           // AEO/GEO answer page (also feeds FAQ schema)
  | "contact"
  | "blog-hub"
  | "comparison"    // vs. competitors
  | "local-hub"     // city or metro landing
  | "local-location"; // individual location page

export type SitemapKeywordIntent = "informational" | "commercial" | "transactional" | "navigational";

export type SitemapPageBrief = {
  // Structural
  id: string;                       // stable id like "pg-home", "pg-svc-fractional-cmo"
  slug: string;                     // URL path, e.g. "/services/fractional-cmo"
  pageType: SitemapPageType;
  title: string;                    // human-facing page title
  parentId?: string;                // for tree structure; undefined = top level

  // SEO/GEO metadata
  primaryKeyword: string;
  secondaryKeywords: string[];      // 3-6
  metaTitle: string;                // ≤ 60 chars
  metaDescription: string;          // ≤ 155 chars
  h1: string;
  keywordIntent: SitemapKeywordIntent;

  // Content structure
  h2Outline: { h2: string; h3s: string[] }[]; // section outline
  geoAnswerBlocks: { question: string; answer: string }[]; // AEO/GEO Q&A blocks (FAQ-schema ready)
  draftBody: string;                // 300-500 word draft body copy in Markdown
  primaryCta: { label: string; targetSlug?: string; targetUrl?: string };

  // Strategy alignment
  uspAlignment: string;             // 1 sentence: which USP this page proves
  compellingOfferTieIn?: string;    // if applicable
  whyUsDifferentiators: string[];   // 2-4 differentiators surfaced on this page
  icpTargets: string[];             // ICP names/labels
  salesRouteMapping?: string;       // which of the 4 sales routes this feeds

  // Linking (populated by cross-linker; readable but writable during regen)
  inboundBlogTitles: string[];      // blog posts that link INTO this page
  inboundSocialTitles: string[];    // social starters that reference this page
  internalLinksOut: { anchorText: string; targetSlug: string }[]; // links FROM this page to other pages
};

export type SitemapPayload = {
  overview: string;                 // 2-3 sentence architecture summary
  totalPages: number;
  hasLocalSection: boolean;
  pages: SitemapPageBrief[];
  // Local SEO section (always generated as optional — empty if not applicable)
  local?: {
    included: boolean;
    guidance: string;               // 2-3 sentences: when to activate
    serviceAreas: string[];         // suggested city/region names
    cityHubSlug?: string;           // if included, the hub page id
    locationPageSlugs: string[];    // individual location page ids
  };
  // Bidirectional linking map summary
  linkingSummary: {
    totalInternalLinks: number;
    blogsLinked: number;            // count of blog posts assigned a targetPageSlug
    socialsLinked: number;
    orphanPages: string[];          // page ids that have no inbound content
  };
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
