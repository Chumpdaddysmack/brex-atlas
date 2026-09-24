export type DemoGroup = "overview" | "strategy" | "frameworks" | "buyer" | "content";
export interface DemoItem {
  label: string;
  text: string;
  sources?: { title: string; url: string }[];
}
export interface DemoSection {
  id: string;
  group: DemoGroup;
  title: string;
  items: DemoItem[];
  fullReport: string;
}
export interface DemoReport {
  mode: "demo";
  version: 1;
  id: string;
  clientName: string;
  clientUrl: string;
  status: string;
  sections: DemoSection[];
}
