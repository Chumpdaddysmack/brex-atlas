// Content-engine pipeline for Brex Atlas Phase 2 — STRATEGY ONLY.
// Single entry point: runContentPlanGeneration(planId).
// Builds the full 12-week plan (blog calendar, ad brief, social cadence,
// landing pages) and materializes content_pieces rows in the "planned" state.
// No per-piece drafting — reviewers work from titles, angles, target queries.

import { storage } from "./storage";
import { llmJson, SCHEMA_SHELL, SCHEMA_BLOG_BATCH, SCHEMA_ROI_ASSUMPTIONS } from "./llm";
import { ROI_INFERENCE_SYSTEM_PROMPT, calculateRoiProjections, FALLBACK_ASSUMPTIONS } from "./roi-calc";
import type { RoiAssumptions } from "@shared/schema";
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
    "icpTarget": "specific ICP the sequence targets — e.g. 'VP Marketing at $10-50M B2B SaaS'",
    "subjectLineA": "question or curiosity-based subject, ≤55 chars",
    "subjectLineB": "pattern-interrupt or specific-observation subject, ≤55 chars",
    "touch1": {
      "day": 0,
      "body": "75-110 words. Personalized opener referencing something specific to the client's ICP or industry. Frame the pain in one sentence. One clear low-friction ask. Sign off in Kenneth's voice per the voice card. No links in touch 1."
    },
    "touch2": {
      "day": 4,
      "body": "50-80 words. Add proof — one specific outcome, one metric, or a competitor comparison. One sentence, then the same ask reframed."
    },
    "touch3": {
      "day": 9,
      "body": "40-70 words. Breakup email. Short, gracious. Ask if timing is wrong or if there's a better person to talk to. Close the loop."
    }
  }
}

Hard rules:
- Content pillars must be 3-5. Every blog post in later batches will be assigned to one of these — pick durable pillar names.
- Landing pages: exactly 5, one per named service/product on the client's site.
- Social starter posts should sound like the voice card's finished voice — the voice card tells you whether to write in first person, founder voice, or brand voice, and which personas may be named.
- Ad creatives MUST use ONLY the approved CTAs listed in the voice card. If the voice card lists three CTAs, every ad's cta field must be one of those three verbatim.

Hero content rules:
- heroMetaAd, heroLinkedInAd, heroColdEmail are ONE fully-written sample each — not concepts, actual ad copy and actual email body text a copywriter would ship (after client review).
- They must sound like the voice card's finished voice.
- Ad CTAs must use ONE of the voice card's approved CTAs verbatim.
- Cold email touch1 must reference something specific about the client's ICP so it doesn't read as generic.

Compactness rules (this JSON must fit in ~6000 output tokens):
- Landing-page \"outline\" arrays: exactly 6-8 items, each a short section label (max ~12 words). NOT a full brief.
- Pillar \"description\": max 25 words.
- Ad creative \"primaryClaim\": one sentence, max 20 words.
- Social starter \"hook\": one sentence, max 20 words.
- No markdown, no commentary, no trailing text outside the JSON object.`;

const SYS_BLOG_BATCH = `You are a senior B2B content strategist. The Voice & Style Card supplied in the user message is the ONLY source of truth for tone, positioning, and protected phrases — do not import personas from any other brand. You are writing a BATCH of the 12-week blog editorial calendar. You will be told which weeks to write (e.g. weeks 1-4), the content pillars the shell pass locked in, the starting Monday date, and any weeks already covered so you can vary titles.

Return ONE JSON object with this exact shape (no prose, no code fences):
{
  "blogCalendar": [
    {
      "weekNumber": 1,
      "weekOf": "YYYY-MM-DD (Monday)",
      "posts": [
        {
          "title": "Question- or buyer-outcome-shaped H1",
          "pillar": "matches a name from the provided contentPillars",
          "targetQuery": "the AEO buyer question this post answers verbatim",
          "angle": "1-2 sentence angle explaining what makes this post specifically the client's",
          "keywords": ["primary keyword", "secondary keyword", "long-tail question"],
          "scheduledDate": "YYYY-MM-DD",
          "editorialBrief": {
            "readerQuestion": "the actual question the ICP is Googling / asking an AI — sentence form",
            "angleSummary": "2 sentences — sentence 1 states the angle; sentence 2 states why this angle is uniquely THIS client's, not a generic thought-leadership take",
            "primaryKeyword": "the one keyword this post ranks for",
            "aeoQuery": "the AEO-shaped buyer question this post owns — the exact wording an AI answer engine would surface"
          }
        }
      ]
    }
  ]
}

Hard rules:
- Return EXACTLY the requested week numbers, each with EXACTLY 10 posts. This is non-negotiable.
- Every blog post title should be question-shaped or outcome-shaped, NOT topic-shaped.
- Every blog post targetQuery should be the exact buyer question a founder/CEO would type into ChatGPT or Google.
- Assign each blog post to one of the provided pillar names — do not invent new pillars.
- Diversify: no more than 2 posts per week can target the same targetQuery, and titles across the batch must not repeat.
- Include at least one competitor-comparison post per 4-week batch when relevant competitors exist.
- Distribute the 10 weekly blog posts across weekdays (2 per day Mon-Fri).
- weekOf is the Monday of that week. scheduledDate must land Mon-Fri of that week.

Editorial-brief rules:
- Every post must include editorialBrief.
- readerQuestion is what the ICP is really asking — use their words, not marketing jargon.
- angleSummary sentence 2 MUST tie the angle to the client's specific IP, data, positioning, or offerings. Do not write generic thought-leadership angles.
- primaryKeyword is one string, not an array.
- aeoQuery is the answer-engine-shaped version of readerQuestion (an AI would cite this post if it answered exactly this question).

Keep angles short (1-2 sentences) and keywords ≤ 3 per post. The 40-post batch JSON must stay compact.`;

export async function runContentPlanGeneration(planId: string) {
  const plan = await storage.getContentPlan(planId);
  if (!plan) return;
  const analysis = await storage.getAnalysis(plan.analysisId);
  if (!analysis) {
    await storage.updateContentPlan(planId, { status: "error", errorMessage: "Analysis not found" });
    return;
  }
  if (!analysis.extraction || !analysis.strategy) {
    await storage.updateContentPlan(planId, { status: "error", errorMessage: "Analysis not yet complete" });
    return;
  }

  try {
    await storage.updateContentPlan(planId, { status: "generating", progress: 15, currentStep: "Designing 12-week content thesis" });

    const extraction: Extraction = JSON.parse(analysis.extraction);
    const strategy: Strategy = JSON.parse(analysis.strategy);
    const competitors: Competitor[] = analysis.competitors ? JSON.parse(analysis.competitors) : [];
    const voice = voiceFor(analysis);

    // Compute Monday-of-current-week ISO date so scheduledDate stays consistent.
    const today = new Date();
    const dow = today.getUTCDay(); // 0=Sun, 1=Mon
    const daysToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() + daysToMonday);
    monday.setUTCHours(12, 0, 0, 0);
    const startISO = monday.toISOString().slice(0, 10);

    const contextBlock = `${voice}\n\n=== CLIENT ANALYSIS (input) ===\nClient: ${analysis.clientName}\nURL: ${analysis.clientUrl}\n\nEXTRACTION:\n${JSON.stringify(extraction, null, 2)}\n\nSTRATEGY:\n${JSON.stringify(strategy, null, 2)}\n\nCOMPETITORS:\n${JSON.stringify(competitors, null, 2)}`;

    // ---- Pass 1: SHELL (thesis, pillars, ads, social, landing pages) ----
    await storage.updateContentPlan(planId, {
      status: "generating",
      progress: 20,
      currentStep: "Designing thesis, pillars, ads, social + landing pages",
    });

    const shellMsg = `${contextBlock}\n\n=== CHANNEL COMMITMENTS ===\n- Organic social: LinkedIn (5/wk), Instagram (3/wk), X (3/wk). Return 3-5 starter posts per channel.\n- Paid ads: Meta + LinkedIn. Return 3-5 creative concepts per channel.\n- Landing pages: exactly 5, one per client service/product marketed on the site.\n\nReturn the SHELL JSON now (no blog calendar — that comes in the next pass).`;

    const shell = await llmJson(SYS_SHELL, shellMsg, 12000, SCHEMA_SHELL);
    console.log(
      `[content-plan] shell keys: ${shell ? Object.keys(shell).join(",") : "null"} | pillars: ${shell?.contentPillars?.length ?? 0}`,
    );
    if (!shell || !Array.isArray(shell.contentPillars) || shell.contentPillars.length === 0) {
      throw new Error(
        `Shell generation returned no contentPillars. Shell keys: ${shell ? Object.keys(shell).join(",") : "null"}`,
      );
    }

    // ---- Passes 2-5: BLOG BATCHES (weeks 1-3, 4-6, 7-9, 10-12) ----
    // 3 weeks × 10 posts = 30 posts per batch. Smaller batches keep each
    // response comfortably under the output token ceiling so Claude doesn't
    // truncate mid-JSON and hand us back an empty blogCalendar.
    const pillarNames: string[] = (shell.contentPillars ?? []).map((p: any) => p.name);
    const batches: Array<{ start: number; end: number }> = [
      { start: 1, end: 3 },
      { start: 4, end: 6 },
      { start: 7, end: 9 },
      { start: 10, end: 12 },
    ];
    const allWeeks: any[] = [];
    const batchErrors: string[] = [];
    let previousTitles: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      await storage.updateContentPlan(planId, {
        progress: 30 + i * 15,
        currentStep: `Writing blog calendar weeks ${b.start}-${b.end}`,
      });

      const blogMsg = `${contextBlock}\n\n=== SHELL (already generated — use these pillars) ===\n${JSON.stringify({ contentPillars: shell.contentPillars, adBriefAudience: shell.adBrief?.[0]?.audience, landingPages: (shell.landingPages ?? []).map((p: any) => p.title) }, null, 2)}\n\n=== YOUR JOB ===\nWrite blog calendar weeks ${b.start} through ${b.end} inclusive (${b.end - b.start + 1} weeks × 10 posts = ${(b.end - b.start + 1) * 10} posts).\n\nPlan starts Monday ${startISO} (that's week 1). weekOf = startMonday + (weekNumber - 1) × 7 days.\n\nAssign each post to a pillar from this list (use these exact names):\n${pillarNames.map((n) => `- ${n}`).join("\n")}\n\n${previousTitles.length ? `Do NOT reuse any of these titles from earlier batches:\n${previousTitles.slice(0, 60).map((t) => `- ${t}`).join("\n")}` : ""}\n\nReturn the JSON now.`;

      try {
        const batchOut = await llmJson(SYS_BLOG_BATCH, blogMsg, 16000, SCHEMA_BLOG_BATCH);
        const weeks = batchOut?.blogCalendar ?? [];
        console.log(
          `[content-plan] batch ${b.start}-${b.end}: keys=${batchOut ? Object.keys(batchOut).join(",") : "null"} weeks=${weeks.length}`,
        );
        if (weeks.length === 0) {
          batchErrors.push(`weeks ${b.start}-${b.end}: returned 0 weeks`);
        }
        allWeeks.push(...weeks);
        for (const w of weeks) for (const p of w.posts ?? []) previousTitles.push(p.title);
      } catch (err: any) {
        const msg = String(err?.message || err).slice(0, 300);
        console.error(`[content-plan] batch ${b.start}-${b.end} threw: ${msg}`);
        batchErrors.push(`weeks ${b.start}-${b.end}: ${msg}`);
      }
    }

    if (allWeeks.length === 0) {
      throw new Error(
        `Blog batches returned 0 weeks total. Shell had ${shell.contentPillars.length} pillars. Batch errors: ${batchErrors.join(" | ")}`,
      );
    }

    // Merge into final payload
    const payload: ContentPlanPayload = {
      summary: shell.summary,
      contentPillars: shell.contentPillars ?? [],
      blogCalendar: allWeeks,
      socialCadence: shell.socialCadence ?? [],
      adBrief: shell.adBrief ?? [],
      landingPages: shell.landingPages ?? [],
      heroMetaAd: shell.heroMetaAd,
      heroLinkedInAd: shell.heroLinkedInAd,
      heroColdEmail: shell.heroColdEmail,
    };

    await storage.updateContentPlan(planId, { progress: 90, currentStep: "Materializing content pieces" });

    // Materialize content_pieces rows.
    const now = Date.now();
    const rows: any[] = [];

    // Blog posts
    for (const week of payload.blogCalendar ?? []) {
      for (const post of week.posts ?? []) {
        rows.push({
          planId,
          analysisId: analysis.id,
          channel: "blog" as Channel,
          title: post.title,
          weekNumber: week.weekNumber,
          scheduledDate: post.scheduledDate,
          pillar: post.pillar,
          targetQuery: post.targetQuery,
          briefJson: JSON.stringify({ angle: post.angle, keywords: post.keywords, editorialBrief: post.editorialBrief }),
          draftJson: null,
          status: "planned",
          reviewNotes: null,
          errorMessage: null,
        });
      }
    }

    // Social starter posts
    for (const cadence of payload.socialCadence ?? []) {
      for (const post of cadence.starterPosts ?? []) {
        rows.push({
          planId,
          analysisId: analysis.id,
          channel: cadence.channel as Channel,
          title: post.title,
          weekNumber: null,
          scheduledDate: null,
          pillar: null,
          targetQuery: post.targetQuery,
          briefJson: JSON.stringify({ hook: post.hook, angle: post.angle }),
          draftJson: null,
          status: "planned",
          reviewNotes: null,
          errorMessage: null,
        });
      }
    }

    // Ad creatives
    for (const brief of payload.adBrief ?? []) {
      for (const creative of brief.creatives ?? []) {
        rows.push({
          planId,
          analysisId: analysis.id,
          channel: brief.channel as Channel,
          title: creative.title,
          weekNumber: null,
          scheduledDate: null,
          pillar: null,
          targetQuery: null,
          briefJson: JSON.stringify({ audience: brief.audience, angle: creative.angle, primaryClaim: creative.primaryClaim, cta: creative.cta }),
          draftJson: null,
          status: "planned",
          reviewNotes: null,
          errorMessage: null,
        });
      }
    }

    // Landing pages
    for (const page of payload.landingPages ?? []) {
      rows.push({
        planId,
        analysisId: analysis.id,
        channel: "landing_page" as Channel,
        title: page.title,
        weekNumber: null,
        scheduledDate: null,
        pillar: null,
        targetQuery: page.targetQuery,
        briefJson: JSON.stringify({ slug: page.slug, serviceOrProduct: page.serviceOrProduct, outline: page.outline }),
        draftJson: null,
        status: "planned",
        reviewNotes: null,
        errorMessage: null,
      });
    }

    await storage.createContentPiecesBulk(rows);

    // -------- ROI Projections --------
    // Infer client-specific assumptions via a small LLM call, then run the
    // deterministic 12-month projection calculator.
    await storage.updateContentPlan(planId, {
      progress: 95,
      currentStep: "Projecting 12-month ROI",
    });

    try {
      // roiSys and analysisContext must include the SOW so the LLM can
      // anchor avgDealSize on the client's own priceTiers. See
      // ROI_INFERENCE_SYSTEM_PROMPT for the derivation rules.
      const analysisContext = JSON.stringify({
        clientName: analysis.clientName,
        clientUrl: analysis.clientUrl,
        extraction: analysis.extraction,
        strategy: analysis.strategy,
        sow: analysis.sow, // CRITICAL: priceTiers drive ACV anchoring.
        competitors: analysis.competitors,
      }).slice(0, 12000); // Larger cap now that SOW is included.

      const roiUser = `# Client Analysis\n${analysisContext}\n\n# Content Plan Summary\n${(payload.summary ?? "").slice(0, 800)}\n\nInfer realistic ROI assumptions for a 12-month content marketing engagement. Follow the priceTiers anchoring rule if a SOW is present.`;

      const assumptions = (await llmJson(
        ROI_INFERENCE_SYSTEM_PROMPT,
        roiUser,
        2000,
        SCHEMA_ROI_ASSUMPTIONS,
      )) as RoiAssumptions;

      payload.roiProjections = calculateRoiProjections(assumptions, payload);
    } catch (roiErr) {
      console.error("[roi-inference] failed, using fallback", roiErr);
      payload.roiProjections = calculateRoiProjections(FALLBACK_ASSUMPTIONS, payload);
    }

    await storage.updateContentPlan(planId, {
      status: "ready",
      progress: 100,
      currentStep: "Ready",
      planJson: JSON.stringify(payload),
    });
  } catch (e: any) {
    console.error("Content plan generation failed", e);
    await storage.updateContentPlan(planId, {
      status: "error",
      errorMessage: e?.message ?? String(e),
    });
  }
}
