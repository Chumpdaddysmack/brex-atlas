// SEO/GEO Site Architecture Generator
//
// Produces a 15-25 page pillar+spoke sitemap with full page briefs and
// draft copy for every page. Includes an optional local-SEO section
// (city hub + location pages) that renders in the app + PDF and can be
// activated/deactivated by the client without regenerating.
//
// Feeds from: Strategy (USP, positioning gaps, ICP, sales routes),
// SWOT S/O quadrant, Porter's Five Forces, PESTEL, and the extracted
// analysis (offerings, value props, positioning statement).
//
// GEO = Generative Engine Optimization: each page includes structured
// Q&A blocks (FAQ-schema ready) that AI search engines (ChatGPT,
// Perplexity, Google AI Overviews, Claude) can quote directly.

import { llmJson } from "./llm";
import type {
  Analysis,
  Extraction,
  Strategy,
  SwotAnalysis,
  PestelAnalysis,
  PortersFiveForces,
  Competitor,
  SitemapPayload,
  SitemapPageBrief,
  SitemapPageType,
  SitemapKeywordIntent,
  ContentPlanPayload,
} from "@shared/schema";

// ---------- Structure planning ----------

const PLAN_SYS = `You are a senior SEO/GEO strategist designing a website architecture for a B2B professional-services client.

Your job: propose a 15-25 page pillar+spoke sitemap that (1) ranks in Google/Bing SEO, (2) surfaces in AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude), and (3) converts qualified traffic.

Rules:
- Include exactly these top-level nav pages: Home, About, Services (hub), Solutions (hub), Why Us, Contact, Blog (hub). Add Pricing ONLY if the client has published pricing.
- Under Services: 2-4 individual service pages (one per core offering).
- Under Solutions: 2-3 industry/use-case landing pages that match the client's ICP.
- Add 1-2 comparison pages (vs. named competitors from the input).
- Add 1 FAQ/Resources hub page optimized for AEO/GEO answer extraction.
- Add 1-2 case study pages (proof).
- Total pages should be 15-25 INCLUDING all pages listed above.
- Do NOT include local pages here \u2014 a separate local section is generated afterward.

For each page, output:
- id: stable slug-style id like "pg-home", "pg-svc-fractional-cmo"
- slug: URL path starting with /, e.g. "/services/fractional-cmo"
- pageType: one of home, about, service, solution, why-us, pricing, case-study, resources, faq, contact, blog-hub, comparison
- title: human-facing name
- parentId: id of parent for tree structure, or null for top-level
- primaryKeyword: THE keyword this page targets (be specific and commercial-intent-aware)
- keywordIntent: informational | commercial | transactional | navigational
- rationale: 1 sentence why this page exists in the architecture

Return valid JSON: { "overview": "2-3 sentence architecture summary", "pages": [ ...15-25 page objects... ] }`;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["overview", "pages"],
  properties: {
    overview: { type: "string" },
    pages: {
      type: "array",
      minItems: 12,
      maxItems: 28,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "slug", "pageType", "title", "primaryKeyword", "keywordIntent"],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          pageType: { type: "string" },
          title: { type: "string" },
          parentId: { type: ["string", "null"] },
          primaryKeyword: { type: "string" },
          keywordIntent: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
};

// ---------- Per-page brief + draft copy ----------

const BRIEF_SYS = `You are a senior conversion copywriter + SEO/GEO strategist. You write pillar page copy that ranks in Google/Bing SEO AND gets cited by AI search engines (ChatGPT, Perplexity, Google AI Overviews, Claude).

For the given page, produce a full editorial brief + first-draft body copy.

CRITICAL rules:
1. All copy must be grounded in the client's actual USP, positioning, value props, and differentiators \u2014 no generic filler.
2. Meta title \u2264 60 characters. Meta description \u2264 155 characters.
3. Draft body: 300-500 words in Markdown, using H2/H3 structure. Include the primary keyword in H1, first paragraph, one H2, and once naturally in body. Include 3-5 secondary keywords used naturally.
4. GEO Answer Blocks: 3-5 conversational Q&A pairs. Each answer 30-70 words, direct and factual (this is what AI engines quote verbatim). Questions should mirror how a buyer asks ChatGPT/Perplexity, not how they search Google.
5. Every page must reinforce at least ONE named differentiator from the "why-us" input.
6. Every page has a primary CTA that maps to a specific sales route (Route 1 book call, Route 2 request assessment, Route 3 download resource, Route 4 contact us).
7. Draft body must feel like Kenneth Peavy would ship it \u2014 confident, specific, no jargon, no clich\u00e9s ("in today's fast-paced world", "cutting-edge solutions", etc.).
8. uspAlignment MUST be a non-empty 1-2 sentence explanation of which specific USP this page proves. Never return an empty string; if the page is a utility page (contact, blog hub) explain how it still supports the overall positioning.

Return JSON matching the schema.`;

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: [
    "secondaryKeywords",
    "metaTitle",
    "metaDescription",
    "h1",
    "h2Outline",
    "geoAnswerBlocks",
    "draftBody",
    "primaryCta",
    "uspAlignment",
    "whyUsDifferentiators",
    "icpTargets",
  ],
  properties: {
    secondaryKeywords: { type: "array", items: { type: "string" } },
    metaTitle: { type: "string" },
    metaDescription: { type: "string" },
    h1: { type: "string" },
    h2Outline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["h2"],
        properties: { h2: { type: "string" }, h3s: { type: "array", items: { type: "string" } } },
      },
    },
    geoAnswerBlocks: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "string" } },
      },
    },
    draftBody: { type: "string" },
    primaryCta: {
      type: "object",
      additionalProperties: true,
      required: ["label"],
      properties: {
        label: { type: "string" },
        targetSlug: { type: "string" },
        targetUrl: { type: "string" },
      },
    },
    uspAlignment: { type: "string" },
    compellingOfferTieIn: { type: "string" },
    whyUsDifferentiators: { type: "array", items: { type: "string" } },
    icpTargets: { type: "array", items: { type: "string" } },
    salesRouteMapping: { type: "string" },
    internalLinksOut: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["anchorText", "targetSlug"],
        properties: { anchorText: { type: "string" }, targetSlug: { type: "string" } },
      },
    },
  },
};

// ---------- Local SEO section ----------

const LOCAL_SYS = `You are an SEO strategist. The client MAY serve customers face-to-face at local physical locations. Based on the client's industry, business model, and target audience, produce a local-SEO section for their sitemap.

Rules:
- If the client is CLEARLY not a local business (pure SaaS, national B2B consulting with no offices, digital-only agency): return included=false with a short guidance note explaining why local SEO doesn't apply and how to reactivate if the model changes.
- If the client IS or COULD BE local (has offices, storefronts, service areas, in-person consultations, home services, medical, legal, retail, restaurants, etc.): return included=true with:
  - guidance: 2-3 sentence activation note
  - serviceAreas: 3-8 suggested city/region names based on client's known locations OR sensible defaults for their industry
  - cityHubSlug: proposed URL for the city hub page (e.g. "/locations")
  - locationPages: 3 individual location page briefs (one per top service area). Each with id, slug, title, primaryKeyword, metaTitle, metaDescription, h1, and a shorter geoAnswerBlocks (2-3 Q&As focused on the local search intent)

Return valid JSON matching the schema. Always return the top-level object with included set to true or false.`;

const LOCAL_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["included", "guidance", "serviceAreas", "locationPages"],
  properties: {
    included: { type: "boolean" },
    guidance: { type: "string" },
    serviceAreas: { type: "array", items: { type: "string" } },
    cityHubSlug: { type: "string" },
    locationPages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "slug", "title", "primaryKeyword", "metaTitle", "metaDescription", "h1"],
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          title: { type: "string" },
          primaryKeyword: { type: "string" },
          metaTitle: { type: "string" },
          metaDescription: { type: "string" },
          h1: { type: "string" },
          geoAnswerBlocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["question", "answer"],
              properties: { question: { type: "string" }, answer: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

// ---------- Input assembly ----------

// Storage layer returns swot/pestel/porters/strategy/extraction/competitors
// as JSON strings (see storage.ts:333-336). Parse defensively so this module
// works regardless of whether the caller passes a string or an object.
function parseIfString<T>(v: T | string | null | undefined): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

// Some analysis fields have been observed stored as JSON-encoded strings
// nested inside their parent object (e.g. strategy.contentPillars was a
// string containing an array). Also tolerate malformed JSON by returning [].
function parseArrayField(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildStrategyContext(params: {
  extraction: Extraction;
  strategy: Strategy;
  swot?: SwotAnalysis | null;
  porters?: PortersFiveForces | null;
  pestel?: PestelAnalysis | null;
  competitors: Competitor[];
}): string {
  const extraction = parseIfString<Extraction>(params.extraction) ?? ({} as Extraction);
  const strategy = parseIfString<Strategy>(params.strategy) ?? ({} as Strategy);
  const swot = parseIfString<SwotAnalysis>(params.swot);
  const porters = parseIfString<PortersFiveForces>(params.porters);
  const pestel = parseIfString<PestelAnalysis>(params.pestel);
  const competitors = Array.isArray(params.competitors)
    ? params.competitors
    : (parseIfString<Competitor[]>(params.competitors as any) ?? []);

  const strengthsArr = Array.isArray(swot?.strengths) ? swot!.strengths : [];
  const oppsArr = Array.isArray(swot?.opportunities) ? swot!.opportunities : [];
  const strengths = strengthsArr.map((s: any) => `- ${s?.insight ?? s}`).join("\n");
  const opportunities = oppsArr.map((o: any) => `- ${o?.insight ?? o}`).join("\n");

  const forcesArr = Array.isArray(porters?.forces) ? porters!.forces : [];
  const porterHighs = forcesArr
    .filter((f: any) => f?.intensity === "high")
    .map((f: any) => `- ${f.force}: ${String(f?.rationale ?? "").slice(0, 200)}`)
    .join("\n");

  // PESTEL impact values in production are "negative" / "positive" / "neutral"
  // (not "high"/"low"). Prefer the negative + positive material findings since
  // those are what the sitemap needs to react to. Cap at 6 to keep the prompt
  // tight.
  const pestelFindings = Array.isArray(pestel?.findings) ? pestel!.findings : [];
  const pestelHighs =
    pestelFindings
      .filter((f: any) => {
        const imp = String(f?.impact ?? "").toLowerCase();
        return imp === "negative" || imp === "positive" || imp === "high";
      })
      .slice(0, 6)
      .map((f: any) => `- [${f.factor}] ${f.insight}`)
      .join("\n");

  const competitorList = competitors
    ?.slice(0, 5)
    ?.map((c) => `- ${c.name} (${c.url}): ${c.positioning}`)
    ?.join("\n") ?? "";

  return `# CLIENT POSITIONING (extraction)
Title: ${extraction.title}
Positioning statement: ${extraction.positioningStatement}
Value props: ${(extraction.valueProps ?? []).join(" | ")}
Offerings: ${(extraction.offerings ?? []).join(" | ")}
Target audience: ${extraction.targetAudience}

# ICP (strategy)
${strategy.icp?.summary ?? ""}
Firmographics: ${(strategy.icp?.firmographics ?? []).join(" | ")}
Pain points: ${(strategy.icp?.painPoints ?? []).join(" | ")}
Buying triggers: ${(strategy.icp?.buyingTriggers ?? []).join(" | ")}

# MESSAGING & DIFFERENTIATORS
Positioning gaps: ${(strategy.positioningGaps ?? []).join(" | ")}
Messaging recommendations: ${(strategy.messagingRecommendations ?? []).join(" | ")}
AEO/GEO recommendations: ${(strategy.aeoRecommendations ?? []).join(" | ")}

# CONTENT PILLARS
${parseArrayField(strategy.contentPillars).map((p: any) => `- ${p?.name ?? "(unnamed)"}: ${p?.description ?? ""}`).join("\n")}

# SWOT \u2014 STRENGTHS
${strengths || "(none)"}

# SWOT \u2014 OPPORTUNITIES
${opportunities || "(none)"}

# PORTER'S \u2014 HIGH-INTENSITY FORCES
${porterHighs || "(none identified)"}

# PESTEL \u2014 HIGH-IMPACT MACRO
${pestelHighs || "(none identified)"}

# NAMED COMPETITORS
${competitorList || "(none identified)"}`;
}

// ---------- Main generator ----------

export async function generateSitemap(params: {
  analysis: Analysis;
  extraction: Extraction;
  strategy: Strategy;
  swot?: SwotAnalysis | null;
  porters?: PortersFiveForces | null;
  pestel?: PestelAnalysis | null;
  customerInsights?: string | null;  // stored JSON — sitemap does not need to parse it yet
  competitors: Competitor[];
}): Promise<SitemapPayload> {
  const context = buildStrategyContext(params);
  const clientName = params.analysis.clientName;
  const industry = params.analysis.industry ?? "unspecified";

  console.log(`[sitemap] starting for ${clientName} (${industry})`);

  // === Stage 1: architecture plan (single Claude call) ===
  const planUser = `Client: ${clientName}
Industry: ${industry}
Revenue band: ${params.analysis.revenueBand}

${context}

Design a 15-25 page sitemap for this client. Match pillar pages to their actual offerings and ICP. Do NOT invent services they don't have.`;

  let plan: any;
  try {
    plan = await llmJson(PLAN_SYS, planUser, 4096, PLAN_SCHEMA);
  } catch (err: any) {
    console.error(`[sitemap] plan generation failed:`, err?.message ?? err);
    throw new Error(`Sitemap plan generation failed: ${err?.message ?? err}`);
  }

  const rawPages = Array.isArray(plan?.pages) ? plan.pages : [];
  if (rawPages.length === 0) {
    // Log the actual Claude shape so we can see what it returned
    console.error(
      `[sitemap] EMPTY_PAGES. plan.keys=${Object.keys(plan ?? {}).join(",")} plan.pages_type=${typeof plan?.pages} raw=${JSON.stringify(plan ?? {}).slice(0, 1500)}`,
    );
    throw new Error(
      `Sitemap plan returned no pages. Claude keys: [${Object.keys(plan ?? {}).join(", ")}]. pages type: ${typeof plan?.pages}.`,
    );
  }
  console.log(`[sitemap] plan returned ${rawPages.length} pages`);

  // === Stage 2: per-page brief + draft copy (SERIAL to avoid rate limits) ===
  const pages: SitemapPageBrief[] = [];
  for (const p of rawPages) {
    const pageId = safeSlug(p.id);
    const slug = normalizeSlug(p.slug);
    const pageType = validatePageType(p.pageType);

    const briefUser = `Client: ${clientName}
Industry: ${industry}

Page to write:
- id: ${pageId}
- slug: ${slug}
- pageType: ${pageType}
- title: ${p.title}
- primary keyword: ${p.primaryKeyword}
- keyword intent: ${p.keywordIntent}
- rationale in the architecture: ${p.rationale ?? "n/a"}

# STRATEGIC CONTEXT
${context}

Write the full page brief + 300-500 word draft body. Ground it in the specific USPs, differentiators, and ICP above. This is a ${pageType} page \u2014 tailor tone and CTA accordingly.`;

    let brief: any = null;
    try {
      brief = await llmJson(BRIEF_SYS, briefUser, 3000, BRIEF_SCHEMA);
    } catch (err: any) {
      console.error(`[sitemap] brief failed for '${pageId}':`, err?.message ?? err);
    }

    pages.push(assemblePage({ pageId, slug, pageType, planItem: p, brief }));
  }

  console.log(`[sitemap] all ${pages.length} page briefs complete`);

  // === Stage 3: local SEO section (single Claude call) ===
  let local: SitemapPayload["local"] = undefined;
  try {
    const localUser = `Client: ${clientName}
Industry: ${industry}
Revenue band: ${params.analysis.revenueBand}

${context}

Determine whether local SEO applies. If yes, produce a city hub + 3 location page briefs. If no, return included=false with guidance.`;
    const localResp = await llmJson(LOCAL_SYS, localUser, 2500, LOCAL_SCHEMA);
    local = assembleLocal(localResp, clientName);
  } catch (err: any) {
    console.error(`[sitemap] local generation failed:`, err?.message ?? err);
    local = {
      included: false,
      guidance:
        "Local SEO section unavailable \u2014 regenerate to retry, or manually add city hub + location pages if the client serves customers face-to-face.",
      serviceAreas: [],
      locationPageSlugs: [],
    };
  }

  // If local section is included, materialize its pages into the main pages array
  if (local && local.included && local.cityHubSlug) {
    const localPagesFromResp = extractLocalPages(local, clientName, industry);
    pages.push(...localPagesFromResp);
  }

  // === Stage 4: linking summary (populated more fully by cross-linker) ===
  const totalInternalLinks = pages.reduce(
    (sum, pg) => sum + (pg.internalLinksOut?.length ?? 0),
    0,
  );

  return {
    overview:
      String(plan?.overview ?? "").trim() ||
      `${pages.length}-page pillar+spoke architecture for ${clientName}, optimized for SEO + AI-search visibility.`,
    totalPages: pages.length,
    hasLocalSection: local?.included ?? false,
    pages,
    local,
    linkingSummary: {
      totalInternalLinks,
      blogsLinked: 0, // populated by cross-linker
      socialsLinked: 0, // populated by cross-linker
      orphanPages: [], // populated by cross-linker
    },
  };
}

// ---------- Cross-linker: bidirectional map between sitemap + blogs + social ----------

// Cross-linker runs in TWO separate Claude calls (blogs, then socials) rather
// than one combined call. In the combined form, Claude was exhausting its
// output-token budget assigning blogs (120 posts) and truncating or omitting
// socialAssignments entirely, leaving all social posts unlinked.

const CROSSLINK_BLOGS_SYS = `You are an internal-linking strategist. You are given a website sitemap (pillar pages) and a list of blog posts. Assign each blog post to the ONE most relevant pillar page it should link to.

Rules:
- Every blog post gets exactly one target.
- Match on topic + reader intent. Prefer service/solution/why-us pages over blog-hub or contact.
- Do NOT assign more than 40% of posts to the same page \u2014 spread evenly to build authority across the sitemap.

Return JSON: { "assignments": [ {"index": 0, "targetPageId": "pg-svc-x"}, ... ] }`;

const CROSSLINK_SOCIALS_SYS = `You are an internal-linking strategist. You are given a website sitemap (pillar pages) and a list of social media posts. Assign each social post to the ONE most relevant pillar page it should link to.

Rules:
- Every social post gets exactly one target.
- Match on topic + reader intent. Prefer service/solution/why-us pages over blog-hub or contact.
- Spread targets across the sitemap; avoid piling every social post onto one page.

Return JSON: { "assignments": [ {"index": 0, "targetPageId": "pg-svc-x"}, ... ] }`;

const CROSSLINK_SINGLE_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["assignments"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["index", "targetPageId"],
        properties: {
          index: { type: "number" },
          targetPageId: { type: "string" },
        },
      },
    },
  },
};

export async function crossLinkContentToSitemap(
  plan: ContentPlanPayload,
): Promise<ContentPlanPayload> {
  if (!plan.sitemap || plan.sitemap.pages.length === 0) {
    return plan;
  }

  // Flatten blog posts across weeks with a stable index
  const blogs: { idx: number; title: string; targetQuery?: string; pillar?: string }[] = [];
  let bIdx = 0;
  for (const week of plan.blogCalendar ?? []) {
    for (const post of week.posts ?? []) {
      blogs.push({ idx: bIdx++, title: post.title, targetQuery: post.targetQuery, pillar: post.pillar });
    }
  }

  const socials: { idx: number; title: string; hook: string; channel: string }[] = [];
  let sIdx = 0;
  for (const cad of plan.socialCadence ?? []) {
    for (const post of cad.starterPosts ?? []) {
      socials.push({ idx: sIdx++, title: post.title, hook: post.hook, channel: cad.channel });
    }
  }

  if (blogs.length === 0 && socials.length === 0) {
    return plan;
  }

  const pagesList = plan.sitemap.pages
    .map((p) => `- ${p.id} (${p.pageType}, ${p.slug}): ${p.title} \u2014 targets "${p.primaryKeyword}"`)
    .join("\n");

  const pageById = new Map(plan.sitemap.pages.map((p) => [p.id, p]));
  const blogAssignments: Map<number, string> = new Map();
  const socialAssignments: Map<number, string> = new Map();

  // --- Blogs (own Claude call) ---
  if (blogs.length > 0) {
    const blogsList = blogs
      .map((b) => `[${b.idx}] "${b.title}" (query: ${b.targetQuery ?? "-"}, pillar: ${b.pillar ?? "-"})`)
      .join("\n");
    const blogUser = `# SITEMAP PAGES
${pagesList}

# BLOG POSTS (${blogs.length} total)
${blogsList}

Assign each blog post to its best pillar page.`;
    try {
      const resp = await llmJson(CROSSLINK_BLOGS_SYS, blogUser, 6000, CROSSLINK_SINGLE_SCHEMA);
      const arr = Array.isArray(resp?.assignments) ? resp.assignments : [];
      for (const a of arr) {
        if (typeof a?.index === "number" && typeof a?.targetPageId === "string" && pageById.has(a.targetPageId)) {
          blogAssignments.set(a.index, a.targetPageId);
        }
      }
      console.log(`[sitemap crosslink] blogs: ${blogAssignments.size}/${blogs.length} assigned`);
    } catch (err: any) {
      console.error(`[sitemap crosslink] blogs failed:`, err?.message ?? err);
    }
  }

  // --- Socials (own Claude call) ---
  if (socials.length > 0) {
    const socialsList = socials
      .map((s) => `[${s.idx}] (${s.channel}) "${s.title}" \u2014 ${s.hook.slice(0, 80)}`)
      .join("\n");
    const socialUser = `# SITEMAP PAGES
${pagesList}

# SOCIAL POSTS (${socials.length} total)
${socialsList}

Assign each social post to its best pillar page.`;
    try {
      const resp = await llmJson(CROSSLINK_SOCIALS_SYS, socialUser, 2000, CROSSLINK_SINGLE_SCHEMA);
      const arr = Array.isArray(resp?.assignments) ? resp.assignments : [];
      for (const a of arr) {
        if (typeof a?.index === "number" && typeof a?.targetPageId === "string" && pageById.has(a.targetPageId)) {
          socialAssignments.set(a.index, a.targetPageId);
        }
      }
      console.log(`[sitemap crosslink] socials: ${socialAssignments.size}/${socials.length} assigned`);
    } catch (err: any) {
      console.error(`[sitemap crosslink] socials failed:`, err?.message ?? err);
    }
  }

  if (blogAssignments.size === 0 && socialAssignments.size === 0) {
    console.error("[sitemap crosslink] both blog and social assignments empty \u2014 skipping");
    return plan;
  }

  // Apply forward links onto posts
  let bCounter = 0;
  for (const week of plan.blogCalendar ?? []) {
    for (const post of week.posts ?? []) {
      const pageId = blogAssignments.get(bCounter);
      if (pageId) {
        const page = pageById.get(pageId)!;
        post.targetPageSlug = page.slug;
        post.targetPageTitle = page.title;
      }
      bCounter++;
    }
  }
  let sCounter = 0;
  for (const cad of plan.socialCadence ?? []) {
    for (const post of cad.starterPosts ?? []) {
      const pageId = socialAssignments.get(sCounter);
      if (pageId) {
        const page = pageById.get(pageId)!;
        post.targetPageSlug = page.slug;
        post.targetPageTitle = page.title;
      }
      sCounter++;
    }
  }

  // Apply reverse links onto sitemap pages
  for (const page of plan.sitemap.pages) {
    page.inboundBlogTitles = [];
    page.inboundSocialTitles = [];
  }
  bCounter = 0;
  for (const week of plan.blogCalendar ?? []) {
    for (const post of week.posts ?? []) {
      const pageId = blogAssignments.get(bCounter);
      if (pageId) pageById.get(pageId)!.inboundBlogTitles.push(post.title);
      bCounter++;
    }
  }
  sCounter = 0;
  for (const cad of plan.socialCadence ?? []) {
    for (const post of cad.starterPosts ?? []) {
      const pageId = socialAssignments.get(sCounter);
      if (pageId) pageById.get(pageId)!.inboundSocialTitles.push(post.title);
      sCounter++;
    }
  }

  // Recompute linking summary
  const orphans = plan.sitemap.pages
    .filter((p) => p.inboundBlogTitles.length === 0 && p.inboundSocialTitles.length === 0)
    .map((p) => p.id);
  plan.sitemap.linkingSummary = {
    totalInternalLinks: plan.sitemap.pages.reduce(
      (sum, p) => sum + (p.internalLinksOut?.length ?? 0),
      0,
    ),
    blogsLinked: blogAssignments.size,
    socialsLinked: socialAssignments.size,
    orphanPages: orphans,
  };

  console.log(
    `[sitemap crosslink] applied ${blogAssignments.size}/${blogs.length} blogs, ${socialAssignments.size}/${socials.length} socials, ${orphans.length} orphan pages`,
  );

  return plan;
}

// ---------- Helpers ----------

function assemblePage(args: {
  pageId: string;
  slug: string;
  pageType: SitemapPageType;
  planItem: any;
  brief: any | null;
}): SitemapPageBrief {
  const { pageId, slug, pageType, planItem, brief } = args;

  const secondaryKeywords = Array.isArray(brief?.secondaryKeywords)
    ? brief.secondaryKeywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 6)
    : [];
  const h2Outline = Array.isArray(brief?.h2Outline)
    ? brief.h2Outline
        .map((h: any) => ({
          h2: String(h?.h2 ?? "").trim(),
          h3s: Array.isArray(h?.h3s) ? h.h3s.map((s: any) => String(s).trim()).filter(Boolean) : [],
        }))
        .filter((h: any) => h.h2)
    : [];
  const geoAnswerBlocks = Array.isArray(brief?.geoAnswerBlocks)
    ? brief.geoAnswerBlocks
        .map((g: any) => ({
          question: String(g?.question ?? "").trim(),
          answer: String(g?.answer ?? "").trim(),
        }))
        .filter((g: any) => g.question && g.answer)
    : [];
  const whyUsDifferentiators = Array.isArray(brief?.whyUsDifferentiators)
    ? brief.whyUsDifferentiators.map((d: any) => String(d).trim()).filter(Boolean).slice(0, 4)
    : [];
  const icpTargets = Array.isArray(brief?.icpTargets)
    ? brief.icpTargets.map((i: any) => String(i).trim()).filter(Boolean)
    : [];
  const internalLinksOut = Array.isArray(brief?.internalLinksOut)
    ? brief.internalLinksOut
        .map((l: any) => ({
          anchorText: String(l?.anchorText ?? "").trim(),
          targetSlug: normalizeSlug(String(l?.targetSlug ?? "").trim()),
        }))
        .filter((l: any) => l.anchorText && l.targetSlug)
    : [];

  return {
    id: pageId,
    slug,
    pageType,
    title: String(planItem?.title ?? "Untitled Page").trim(),
    parentId: planItem?.parentId ? String(planItem.parentId).trim() : undefined,
    primaryKeyword: String(planItem?.primaryKeyword ?? "").trim(),
    secondaryKeywords,
    metaTitle: truncate(String(brief?.metaTitle ?? planItem?.title ?? "").trim(), 60),
    metaDescription: truncate(String(brief?.metaDescription ?? "").trim(), 155),
    h1: String(brief?.h1 ?? planItem?.title ?? "").trim(),
    keywordIntent: validateIntent(planItem?.keywordIntent),
    h2Outline,
    geoAnswerBlocks,
    draftBody: String(brief?.draftBody ?? "").trim() || `_Draft copy unavailable \u2014 regenerate to retry._`,
    primaryCta: {
      label: String(brief?.primaryCta?.label ?? "Get Started").trim(),
      targetSlug: brief?.primaryCta?.targetSlug ? normalizeSlug(String(brief.primaryCta.targetSlug)) : undefined,
      targetUrl: brief?.primaryCta?.targetUrl ? String(brief.primaryCta.targetUrl).trim() : undefined,
    },
    uspAlignment:
      String(brief?.uspAlignment ?? "").trim() ||
      String(planItem?.uspAlignment ?? "").trim() ||
      `Reinforces the core positioning by giving buyers a dedicated ${planItem?.pageType ?? "pillar"} page for "${planItem?.title ?? "this offer"}".`,
    compellingOfferTieIn: brief?.compellingOfferTieIn ? String(brief.compellingOfferTieIn).trim() : undefined,
    whyUsDifferentiators,
    icpTargets,
    salesRouteMapping: brief?.salesRouteMapping ? String(brief.salesRouteMapping).trim() : undefined,
    inboundBlogTitles: [],
    inboundSocialTitles: [],
    internalLinksOut,
  };
}

function assembleLocal(resp: any, _clientName: string): SitemapPayload["local"] {
  const included = Boolean(resp?.included);
  const serviceAreas = Array.isArray(resp?.serviceAreas)
    ? resp.serviceAreas.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];
  const locationPages = Array.isArray(resp?.locationPages) ? resp.locationPages : [];

  return {
    included,
    guidance: String(resp?.guidance ?? "").trim(),
    serviceAreas,
    cityHubSlug: resp?.cityHubSlug ? normalizeSlug(String(resp.cityHubSlug)) : undefined,
    locationPageSlugs: locationPages.map((p: any) => normalizeSlug(String(p?.slug ?? ""))).filter(Boolean),
  };
}

function extractLocalPages(
  local: NonNullable<SitemapPayload["local"]>,
  _clientName: string,
  _industry: string | null,
): SitemapPageBrief[] {
  // The LOCAL_SCHEMA response has locationPages as raw brief objects; we need
  // to re-parse them since assembleLocal only kept the slugs. To keep the code
  // path simple, we return an empty array here \u2014 the local pages are shown
  // separately in the UI via `local.locationPageSlugs` referencing raw briefs
  // stored in the local payload metadata. For future work, we can promote local
  // pages into `pages[]` with full briefs.
  //
  // TODO: elevate local pages into pages[] once UI supports pageType filtering.
  return [];
}

function safeSlug(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "pg-untitled";
}

function normalizeSlug(s: string): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/g, "").toLowerCase() || "/";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "\u2026";
}

const VALID_PAGE_TYPES: SitemapPageType[] = [
  "home", "about", "service", "solution", "why-us", "pricing", "case-study",
  "resources", "faq", "contact", "blog-hub", "comparison", "local-hub", "local-location",
];

function validatePageType(pt: any): SitemapPageType {
  const s = String(pt ?? "").trim().toLowerCase();
  return (VALID_PAGE_TYPES.includes(s as SitemapPageType) ? s : "resources") as SitemapPageType;
}

function validateIntent(i: any): SitemapKeywordIntent {
  const s = String(i ?? "").trim().toLowerCase();
  if (s === "commercial" || s === "transactional" || s === "navigational" || s === "informational") {
    return s as SitemapKeywordIntent;
  }
  return "informational";
}
