// Content-engine pipeline for Brex Atlas Phase 2 — STRATEGY ONLY.
// Single entry point: runContentPlanGeneration(planId).
// Builds the full 12-week plan (blog calendar, ad brief, social cadence,
// landing pages) and materializes content_pieces rows in the "planned" state.
// No per-piece drafting — reviewers work from titles, angles, target queries.

import { storage } from "./storage";
import { llmJson, SCHEMA_SHELL, SCHEMA_BLOG_BATCH } from "./llm";
import { BREX_VOICE } from "./voice/brex";
import { CONCENTRUS_VOICE } from "./voice/concentrus";
import type {
  Analysis,
  ContentPlanPayload,
  Extraction,
  Competitor,
  Strategy,
  Channel,
} from "@shared/schema";

// ---------- Voice selector ----------
// For now every analysis gets Brex voice (the user is the first customer). Later
// this switches on clientName / a stored brand-voice profile.
function voiceFor(analysis: Analysis): string {
  const name = (analysis.clientName || "").toLowerCase();
  const url = (analysis.clientUrl || "").toLowerCase();
  if (name.includes("concentrus") || url.includes("concentrus.com")) {
    return CONCENTRUS_VOICE;
  }
  if (name.includes("brex") || name.includes("big rock") || url.includes("brexconsulting.com")) {
    return BREX_VOICE;
  }
  // Fallback: generic B2B voice with AEO scaffolding.
  return `# Generic B2B Voice\n- Diagnostic, opinionated, insight-first.\n- AEO structure: quick answer, question-shaped H2s, Key Takeaways, FAQ, references.`;
}

// ---------- System prompts ----------

// The plan is generated in TWO passes to keep any single JSON payload well under
// the model's max_tokens budget and avoid unbalanced-JSON truncation.
//
//   1) SHELL — thesis, pillars, ad brief, social cadence, landing pages.
//   2) BLOG BATCH — 4 weeks of blog calendar at a time (called 3× → 12 weeks).
//
// The shell pass runs first so downstream blog batches can reference the pillar
// names, ICP, and competitor set the model just committed to.

const SYS_SHELL = `You are a senior B2B content strategist. The Voice & Style Card supplied in the user message is the ONLY source of truth for tone, positioning, protected phrases, and approved CTAs — do not import personas, CTAs, or protected phrases from any other brand. You are designing the SHELL of a 12-week integrated content plan: the strategic thesis, content pillars, paid-ad brief, organic-social cadence, and service/product landing pages. A separate step will produce the 12 weeks of blog calendar.

Return ONE JSON object with this exact shape (no prose, no code fences):
{
  "summary": "3-4 sentence explanation of the 12-week thesis and how the channels reinforce each other.",
  "contentPillars": [
    { "name": "...", "description": "1-2 sentence description of what this pillar owns" }
    // exactly 3-5 pillars
  ],
  "socialCadence": [
    {
      "channel": "linkedin" | "instagram" | "x",
      "postsPerWeek": integer,
      "starterPosts": [
        { "title": "internal name", "hook": "opening line", "targetQuery": "the AEO buyer question", "angle": "why this works on this channel" }
        // 3-5 starter posts per channel
      ]
    }
  ],
  "adBrief": [
    {
      "channel": "meta_ad" | "linkedin_ad",
      "audience": "1-2 sentence audience definition — ICP, firmographics, job titles, buying stage",
      "creatives": [
        { "title": "internal creative name", "angle": "hook framing", "primaryClaim": "one sentence claim we would test", "cta": "one of the approved CTAs from the voice card" }
        // 3-5 creative concepts per channel
      ]
    }
  ],
  "landingPages": [
    {
      "title": "H1",
      "slug": "url-slug",
      "serviceOrProduct": "which client service/product this page sells",
      "targetQuery": "AEO buyer question this page ranks for",
      "outline": ["Section 1: ...", "Section 2: ...", "..."]
    }
    // exactly 5 pages, one per client service/product
  ],
  "heroMetaAd": {
    "headline": "≤40 chars — punchy Facebook ad headline",
    "primaryText": "≈125 chars — the body text above the image. Include the hook, the pain, and the CTA lead-in. Written for the ICP, not for us.",
    "description": "≤30 chars — the small text under the headline",
    "cta": "ONE of the voice card's approved CTAs, verbatim",
    "visualConcept": "1-2 sentences describing the image or video creative concept"
  },
  "heroLinkedInAd": {
    "introText": "≈150 chars — the text above the ad card. Founder-voice or brand-voice per the voice card. Speak to the ICP's specific role.",
    "headline": "≤70 chars — LinkedIn ad card headline",
    "description": "≈100 chars — the description under the headline",
    "cta": "ONE of the voice card's approved CTAs, verbatim",
    "visualConcept": "1-2 sentences describing the image or single-image creative concept"
  },
  "heroColdEmail": {
    "icpTarget": "specific ICP the sequence targets — e.g.
