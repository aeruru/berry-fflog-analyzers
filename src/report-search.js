const RAW_REPORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;
const FFLOGS_REPORT_URL_PATTERN = /^https:\/\/www\.fflogs\.com\/reports\/([A-Za-z0-9]+)(?:\?.*)?$/;

export function parseFflogsReportCode(value) {
  if (RAW_REPORT_CODE_PATTERN.test(value)) {
    return value;
  }

  return value.match(FFLOGS_REPORT_URL_PATTERN)?.[1] ?? null;
}
