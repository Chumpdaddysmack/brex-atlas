import { Card } from "@/components/ui/card";
import { ENGAGEMENT } from "@shared/engagement-terms";

export function EngagementTerms() {
  return <Card className="p-5 sm:p-6 mb-6" data-testid="engagement-terms">
    <h3 className="text-lg font-semibold">{ENGAGEMENT.title}</h3>
    <p className="text-base leading-relaxed mt-2 font-medium">{ENGAGEMENT.term}</p>
    <p className="text-sm leading-relaxed mt-3">{ENGAGEMENT.commitment}</p>
    <p className="text-sm leading-relaxed mt-3">{ENGAGEMENT.onRamp}</p>
    <p className="text-sm leading-relaxed mt-3">{ENGAGEMENT.continuation}</p>
    <p className="text-xs leading-relaxed text-muted-foreground mt-3">{ENGAGEMENT.caveat}</p>
  </Card>;
}
