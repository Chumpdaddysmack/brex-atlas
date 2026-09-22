import { jsonrepair } from "jsonrepair";
import type { ContentPlanPayload } from "@shared/schema";

type Calendar = ContentPlanPayload["blogCalendar"];
type CalendarOptions = {
  expectedWeeks?: number[];
  postsPerWeek?: number;
  requireCompleteBrief?: boolean;
};
const isObject = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Decode structure, never silently discard weeks/posts or manufacture content.
// A legacy spread of a string produces one array element per character.
function decode(value: unknown, depth = 0): unknown[] {
  if (depth > 4) throw new Error("Blog calendar is too deeply encoded");
  if (typeof value === "string") {
    if (value.length > 2_000_000) throw new Error("Blog calendar text exceeds safe size");
    const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { parsed = JSON.parse(jsonrepair(text)); }
    return decode(parsed, depth + 1);
  }
  if (!Array.isArray(value)) throw new Error("Blog calendar must be an array of weeks");
  if (value.length > 200_000) throw new Error("Blog calendar exceeds safe size");
  const weeks: unknown[] = [];
  let characters: string[] = [];
  const flush = () => {
    if (characters.length) {
      weeks.push(...decode(characters.join(""), depth + 1));
      characters = [];
    }
  };
  for (const entry of value) {
    if (typeof entry === "string" && Array.from(entry).length === 1) {
      characters.push(entry);
    } else {
      flush();
      if (typeof entry === "string") weeks.push(...decode(entry, depth + 1));
      else weeks.push(entry);
    }
    if (weeks.length > 100) throw new Error("Blog calendar exceeds 100 weeks");
  }
  flush();
  return weeks;
}

export function normalizeBlogCalendar(value: unknown, options: CalendarOptions = {}): Calendar {
  const weeks = decode(value);
  if (!weeks.length || weeks.length > 100) throw new Error("Blog calendar must contain 1–100 weeks");
  const seen = new Set<number>();
  for (let index = 0; index < weeks.length; index++) {
    const week = weeks[index];
    if (!isObject(week)) throw new Error(`Calendar entry ${index + 1} is not a week object`);
    if (!Number.isInteger(week.weekNumber) || week.weekNumber < 1 || week.weekNumber > 100 ||
        seen.has(week.weekNumber)) throw new Error("Calendar has invalid or duplicate week numbers");
    seen.add(week.weekNumber);
    if (!isDate(week.weekOf)) throw new Error(`Week ${week.weekNumber} has an invalid date`);
    if (!Array.isArray(week.posts) || !week.posts.length || week.posts.length > 20)
      throw new Error(`Week ${week.weekNumber} must contain 1–20 posts`);
    if (options.postsPerWeek !== undefined && week.posts.length !== options.postsPerWeek)
      throw new Error(`Week ${week.weekNumber} must contain ${options.postsPerWeek} posts`);
    for (const post of week.posts) {
      if (!isObject(post) || !["title", "pillar", "targetQuery", "angle"].every(k => isText(post[k])) ||
          !isDate(post.scheduledDate) || !Array.isArray(post.keywords) || !post.keywords.every(isText))
        throw new Error(`Week ${week.weekNumber} contains a malformed post`);
      if (post.editorialBrief !== undefined || options.requireCompleteBrief) {
        if (!isObject(post.editorialBrief) ||
            !["readerQuestion", "angleSummary", "primaryKeyword", "aeoQuery"]
              .every(k => isText(post.editorialBrief[k])))
          throw new Error(`Week ${week.weekNumber} contains an incomplete editorial brief`);
      }
    }
  }
  if (options.expectedWeeks && (seen.size !== options.expectedWeeks.length ||
      options.expectedWeeks.some(n => !seen.has(n))))
    throw new Error(`Expected calendar weeks ${options.expectedWeeks.join(", ")}`);
  return (weeks as Calendar).sort((a, b) => a.weekNumber - b.weekNumber);
}

export async function generateValidatedBlogBatch(
  generate: (validationError?: string) => Promise<unknown>,
  expectedWeeks: number[],
): Promise<Calendar> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const output = await generate(lastError || undefined);
      if (!isObject(output)) throw new Error("Blog response must be an object");
      return normalizeBlogCalendar(output.blogCalendar, {
        expectedWeeks, postsPerWeek: 10, requireCompleteBrief: true,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid blog response";
    }
  }
  throw new Error(`Blog batch failed validation after two attempts: ${lastError}`);
}
