export const JRE_STATUS_HELP = `
Usage: jls jre status

显示内嵌 JRE 的状态（来源、版本、路径、就绪状态）。
`;

export const JRE_DOWNLOAD_HELP = `
Usage: jls jre download [options]

下载或重新下载内嵌 Adoptium JRE 21。

Options:
  --choose     交互选择下载源
  -h, --help   显示帮助

Examples:
  jls jre download
  jls jre download --choose
`;

export const JRE_REMOVE_HELP = `
Usage: jls jre remove

删除内嵌 JRE，后续回退使用系统 Java。
`;
