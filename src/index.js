const core = require('@actions/core');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} TranslationFileReport
 * @property {string} defaultLocale
 * @property {string} compareLocale
 * @property {[string, string][]} keysToAdd
 * @property {[string, string][]} keysToRemove
 * @property {string[]} errors
 *
 * @typedef {Object.<string, TranslationFileReport>} TranslationFileReportsMap
 *
 * @typedef {Object.<string, TranslationFileReportsMap>} TranslationLocalesReportsMap
 */

// most @actions toolkit packages have async methods
async function run() {
  try {
    const sharedFolderPathsParam = core.getInput('shared_folder_paths', {
      required: true,
    });

    console.debug('sharedFolderPathsParam: ', sharedFolderPathsParam);

    /**
     * @type {string[]}
     */
    let sharedFolderPaths;
    try {
      // try raw JSON string
      sharedFolderPaths = JSON.parse(sharedFolderPathsParam);
    } catch (e) {
      // else try reading as file
      const sharedFolderPathsJSON = fs.readFileSync(sharedFolderPathsParam, {
        encoding: 'utf8',
      });
      sharedFolderPaths = JSON.parse(sharedFolderPathsJSON);
    }

    if (!validateBaseFolderInput(sharedFolderPaths)) {
      core.setFailed(
        'Base locale folders JSON is is not an array of arrays with at least one entry in each array: ' +
          sharedFolderPathsParam
      );
      return;
    }

    const defaultLocale = core.getInput('default_locale') || 'en';
    const defaultBase = core.getInput('default_base') || '';
    const compareBase = core.getInput('compare_base') || '';
    const compareLocalesJSON = core.getInput('compare_locales', {
      required: true,
    });

    core.info('Default locale: ', defaultLocale);
    const compareLocales = JSON.parse(compareLocalesJSON);
    if (!Array.isArray(compareLocales)) {
      core.setFailed('Array of comparison locale folder names not provided.');
      return;
    }

    /**
     * @type TranslationLocalesReportsMap
     */
    const comparisonReports = compareLocales.reduce((prev, locale) => {
      prev[locale] = compareTranslationsKeysForLocale(
        sharedFolderPaths,
        defaultBase,
        compareBase,
        defaultLocale,
        locale
      );
      return prev;
    }, {});

    await prettyPringComparisonReport(comparisonReports, defaultLocale);

    core.setOutput('comparisonReports', comparisonReports);
  } catch (error) {
    core.setFailed(error.message);
  }
}

/**
 *
 * @param {TranslationLocalesReportsMap>} comparisonReports
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
 * @param {TranslationLocalesReportsMap} comparisonReports
 * @param {string} defaultLocale
 */
async function prettyPringComparisonReport(comparisonReports, defaultLocale) {
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
    Object.entries(reports).forEach(([path, report]) => {
      const pathErrors =
        report.errors.length > 0 ||
        report.keysToAdd.length > 0 ||
        report.keysToRemove.length > 0;
      localErrors = localErrors || pathErrors;

      const pathStyle = pathErrors ? styles.redBright : styles.greenBright;

      output.push([
        getStyledText(pathStyle, `  ${path} ${pathErrors ? '✖' : '✓'}`),
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

function validateBaseFolderInput(baseFolderJSON) {
  let valid = false;

  if (Array.isArray(baseFolderJSON) && baseFolderJSON.length > 0) {
    valid = baseFolderJSON.every((entry) => {
      const maybeValid = Array.isArray(entry) && entry.length > 0;
      return maybeValid && typeof entry[0] === 'string'; // at least one path string defined
    });
  }
  return valid;
}

/**
 *
 * @param {[string, string][]} folderPaths
 * @param {string} defaultBase
 * @param {string} compareBase
 * @param {string} defaultLocale
 * @param {string} compareLocale
 * @returns
 */
function compareTranslationsKeysForLocale(
  folderPaths,
  defaultBase,
  compareBase,
  defaultLocale,
  compareLocale
) {
  /**
   * @type {Object.<string, TranslationFileReport}>}
   */
  const pathToStringsReport = {};

  folderPaths.forEach(([sharedPath, customPrefix]) => {
    const defaultLocalePath = path.join(defaultBase, sharedPath, defaultLocale);
    const compareLocalePath = path.join(compareBase, sharedPath, compareLocale);

    core.debug('PROCESSING sharedPath: ' + sharedPath); // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true

    try {
      const defaultPaths = getTranslationFilesAndKeyPrefixes(
        defaultLocalePath,
        customPrefix
      );

      defaultPaths.forEach(({full, file, prefix, subfolder}) => {
        const defaultPathToOpen = path.normalize(full);
        const compareFileToOpen = path.normalize(
          path.join(compareLocalePath, subfolder, file)
        );

        /**
         * @type {TranslationFileReport}
         */
        const fileReport = {
          defaultLocale,
          compareLocale,
          keysToAdd: [],
          keysToRemove: [],
          errors: [],
        };

        try {
          const defaultTranslationsJSON = fs.readFileSync(
            defaultPathToOpen,
            'utf8'
          );
          const defaultTranslations = JSON.parse(defaultTranslationsJSON);

          let compareTranslations;
          try {
            const compareTranslationsJSON = fs.readFileSync(
              compareFileToOpen,
              'utf8'
            );
            compareTranslations = JSON.parse(compareTranslationsJSON);
          } catch (e) {
            // compareFileToOpen opening error
            fileReport.errors.push(e.toString());
            compareTranslations = {};
          }
          const defaultKeys = getTranslationKeyPaths(
            prefix,
            defaultTranslations
          );
          const compareKeys = getTranslationKeyPaths(
            prefix,
            compareTranslations
          );
          const fullKeysToAdd = [...defaultKeys].filter(
            (key) => !compareKeys.has(key)
          );
          const fullKeysToremove = [...compareKeys].filter(
            (key) => !defaultKeys.has(key)
          );

          fileReport.keysToAdd = getFullAndFileRelativeKeys(
            prefix,
            fullKeysToAdd
          );
          fileReport.keysToRemove = getFullAndFileRelativeKeys(
            prefix,
            fullKeysToremove
          );
        } catch (e) {
          // defaultPathToOpen opening error
          fileReport.errors.push(e.toString());
        }

        pathToStringsReport[compareFileToOpen] = fileReport;
      });
    } catch (e) {
      // file walking error
      core.error(e);
    }
  });

  return pathToStringsReport;
}

/**
 * Walk the directory and get translation.json file descriptors
 * @param {string} dir
 * @param {string} prefix
 * @returns {{full: string, file: string, dir: string, prefix: string, subfolder: string}[]}
 */
function getTranslationFilesAndKeyPrefixes(dir, prefix = '', initRoot = null) {
  const paths = [];
  const root = initRoot || dir;

  fs.readdirSync(dir).forEach((f) => {
    const dirPath = path.join(dir, f);
    const stat = fs.statSync(dirPath);
    if (stat.isDirectory() && f.length > 0 && f[0] !== '.') {
      paths.push(
        ...getTranslationFilesAndKeyPrefixes(
          dirPath,
          prefix ? `${prefix}.${f}` : f,
          root
        )
      );
    } else if (stat.isFile() && f === 'translation.json') {
      paths.push({
        full: dirPath,
        file: f,
        dir,
        prefix,
        subfolder: path.relative(root, dir),
      });
    }
  });
  return paths;
}

/**
 *
 * @param {string} prefix
 * @param {string[]} keys
 * @returns
 */
function getFullAndFileRelativeKeys(prefix, keys) {
  const prefixLength = prefix?.length;
  return keys.map((full) => [
    full,
    prefixLength > 0 ? full?.slice(prefixLength + 1) : full,
  ]);
}

/**
 *
 * @param {string} keyPath
 * @param {{}} translationObject
 * @returns {Set<string>}
 */
function getTranslationKeyPaths(keyPath, translationObject) {
  let keyPaths = new Set();
  const prepend = keyPath?.length > 0 ? `${keyPath}.` : '';

  Object.entries(translationObject).forEach(([key, value]) => {
    const newKeyPath = `${prepend}${key}`;

    if (typeof value === 'object') {
      const translationValue = value?.['translation'];
      if (typeof translationValue === 'string') {
        // path is a translation object with actual string on "translation" value
        keyPaths.add(newKeyPath);
      } else {
        keyPaths = new Set([
          ...keyPaths.values(),
          ...getTranslationKeyPaths(newKeyPath, value).values(),
        ]);
      }
    } else {
      keyPaths.add(newKeyPath);
    }
  });
  return keyPaths;
}

// Execute the script

run();
