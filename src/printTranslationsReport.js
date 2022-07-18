const core = require('@actions/core');
const path = require('path');

/* eslint-disable-next-line no-unused-vars */
const typedefs = require('./typedefs');

/**
 *
 * @param {typedefs.TranslationLocalesReportsMap>} comparisonReports
 * @returns Totals for comparison report
 */
 function getTotals(comparisonReports) {
  return Object.values(comparisonReports).reduce(
    (prevOuter, fileReports) =>
      Object.values(fileReports).reduce((prev, fileReport) => {
        prev.totalKeysToAdd += fileReport.keysToAdd.length;
        prev.totalKeysToRemove += fileReport.keysToRemove.length;
        return prev;
      }, prevOuter),
    {totalKeysToAdd: 0, totalKeysToRemove: 0}
  );
}

/**
 *
 * @param {typedefs.TranslationLocalesReportsMap} comparisonReports
 * @param {string} defaultLocale
 */
async function prettyPrintComparisonReport(comparisonReports, defaultLocale, compareBase) {
  const {default: styles} = await import('ansi-styles');
  core.notice(
    getStyledText(
      styles.bold,
      `Comparing languages against default locale: "${defaultLocale}"`
    )
  );

  const {totalKeysToAdd, totalKeysToRemove} = getTotals(comparisonReports);

  core.notice(
    `Total keys to add: ${getStyledText(
      styles.bold,
      totalKeysToAdd
    )}, Total keys to remove: ${getStyledText(styles.bold, totalKeysToRemove)}`
  );

  Object.entries(comparisonReports).forEach(([locale, reports]) => {
    const localeReportTitle = `Report for "${locale}":`;

    const output = [];
    let localErrors = false;
    Object.entries(reports).forEach(([comparePath, report]) => {
      const pathErrors =
        report.errors.length > 0 ||
        report.keysToAdd.length > 0 ||
        report.keysToRemove.length > 0;
      localErrors = localErrors || pathErrors;

      const pathStyle = pathErrors ? styles.redBright : styles.greenBright;

      output.push([
        getStyledText(pathStyle, `  ${path.relative(compareBase, comparePath)} ${pathErrors ? '✖' : '✓'}`),
        pathErrors,
      ]);

      if (report.errors.length > 0) {
        output.push([getStyledText(pathStyle, `    Errors:`), pathErrors]);
      }
      report.errors.forEach((error) =>
        output.push([getStyledText(pathStyle, `      ✖ ${error}`), pathErrors])
      );

      if (report.keysToAdd.length > 0) {
        output.push([getStyledText(pathStyle, `    Keys to add:`), pathErrors]);
      }
      report.keysToAdd.forEach(([fullKey, fileKey]) =>
        output.push([
          getStyledText(pathStyle, `      + ${fullKey} (${fileKey})`),
          pathErrors,
        ])
      );

      if (report.keysToRemove.length > 0) {
        output.push([
          getStyledText(pathStyle, `    Keys to remove:`),
          pathErrors,
        ]);
      }
      report.keysToRemove.forEach(([fullKey, fileKey]) =>
        output.push([
          getStyledText(pathStyle, `      - ${fullKey} (${fileKey})`),
          pathErrors,
        ])
      );
    });

    if (localErrors) {
      core.startGroup(
        getStyledText(styles.redBright, localeReportTitle + ' ✖')
      );
    } else {
      core.startGroup(
        getStyledText(styles.greenBright, localeReportTitle + ' ✓')
      );
    }
    output.forEach(([msg, error]) =>
      error ? core.error(msg) : core.notice(msg)
    );
    core.endGroup();
  });
}

/**
 *
 * @param {{}}} style
 * @param {string} text
 */
function getStyledText(style, text) {
  return `${style.open}${text}${style.close}`;
}

exports.prettyPrintComparisonReport = prettyPrintComparisonReport;