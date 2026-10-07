// Synthetic, local-only QA input. Never write these figures to production.
export const executivePdfInput = {
  clientName: "Example Services (QA)",
  extraction: {
    positioningStatement: "Documented specialist services for regional operators.",
    targetAudience: "Regional operations leaders.",
    companyProfile: { version: 1, researchedAt: "2026-10-06T12:00:00Z", facts: [
      { key: "annualRevenue", sentence: "QA ONLY: Revenue is estimated at $8 million, not independently verified.",
        status: "estimate", sources: [{ title: "QA financial reference", url: "https://example.com/revenue", date: "2025" }] },
      { key: "employees", sentence: "QA ONLY: The company reports 30 employees.",
        status: "reported", sources: [{ title: "QA company reference", url: "https://example.com/about" }] },
    ] },
  },
  strategy: {
    icp: { summary: "Regional operators evaluating specialist service partners." },
    positioningGaps: ["Specialist expertise needs clearer supporting proof."],
    messagingRecommendations: ["Test proof-led messages with the selected buyer group."],
    channelMix: [{ channel: "Search", role: "Support active solution research.", priority: "High" }],
    ninetyDayPlan: [{ phase: "Foundation", focus: "Validate positioning and buyer needs.",
      outcomes: ["Agreed measurement baseline, subject to access and validation."] }],
  },
  porters: { forces: [{ force: "buyerPower", rationale: "QA ONLY: Buyer power is assessed as high, not measured as a margin effect.",
    sources: [{ title: "QA market reference", url: "https://example.com/market" }] }] },
};

export const executivePdfPayload = {
  summary: "QA content strategy: build proof and establish a measurement baseline before expanding delivery.",
  contentPillars: [{ name: "Expertise", description: "Demonstrate specialist knowledge." }],
  blogCalendar: Array.from({ length: 12 }, (_, i) => {
    const start = new Date(Date.UTC(2026, 9, 5 + i * 7));
    return { weekNumber: i + 1, weekOf: start.toISOString().slice(0, 10),
      posts: Array.from({ length: 10 }, (_, n) => ({
        title: `QA week ${i + 1} post ${n + 1}`, pillar: "Expertise", targetQuery: "How do buyers evaluate expertise?",
        angle: "Explain the supporting evidence.", keywords: ["expertise"],
        scheduledDate: new Date(start.getTime() + Math.floor(n / 2) * 86400000).toISOString().slice(0, 10),
        editorialBrief: { readerQuestion: "How do buyers evaluate expertise?", angleSummary: "Explain the supporting evidence.",
          primaryKeyword: "expertise", aeoQuery: "How do buyers evaluate expertise?" },
      })) };
  }),
  socialCadence: [], adBrief: [], landingPages: [],
};
