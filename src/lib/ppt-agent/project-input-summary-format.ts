import type { PptProjectInputSummary } from "./project-input-summary";

export function formatPptProjectInputSummary(
  summary: PptProjectInputSummary,
) {
  const sections = summary.textSections.map(
    (section) => `${section.label}\n${section.value}`,
  );
  if (summary.sourceFiles.length > 0) {
    sections.push(`上传资料\n${summary.sourceFiles.join("\n")}`);
  }
  if (summary.templateFiles.length > 0) {
    sections.push(`上传模板\n${summary.templateFiles.join("\n")}`);
  }
  if (summary.settings.length > 0) {
    sections.push(
      `生成设置\n${summary.settings
        .map((setting) => `${setting.label}：${setting.value}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}
