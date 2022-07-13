const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const wait = require('./wait');

/**
 * @typedef {Object} TranslationFileReport
 * @property {string} defaultLocale
 * @property {string} compareLocale
 * @property {[string, string][]} keysToAdd
 * @property {[string, string][]} keysToRemove
 * @property {string[]} errors
 */

// most @actions toolkit packages have async methods
async function run() {
  try {
    const sharedFolderPathsJSON = core.getInput('shared_folder_paths', { required: true });

    console.log('sharedFolderPathsJSON: ', sharedFolderPathsJSON)

    /**
     * @type {string[]} 
     */
    let sharedFolderPaths;
    try {
      // try raw JSON string
      sharedFolderPaths = JSON.parse(sharedFolderPathsJSON);
    } catch (e) {
      // else try reading as file
      const baseFoldersTxt = fs.readFileSync(sharedFolderPathsJSON, {
        encoding: 'utf8',
      });
      sharedFolderPaths = JSON.parse(baseFoldersTxt);
    }

    if (!validateBaseFolderInput(sharedFolderPaths)) {
      core.setFailed(
        'Base locale folders JSON is is not an array of arrays with at least one entry in each array: ' +
        sharedFolderPathsJSON
      );
      return;
    }

    const defaultBase = core.getInput('default_base') || '';
    const compareBase = core.getInput('compare_base') || '';
    const compareLocalesJSON = core.getInput('compare_locales', {required: true});

    const compareLocales = JSON.parse(compareLocalesJSON);
    if (!Array.isArray(compareLocales)) {
      core.setFailed('Array of comparison locale folder names not provided.');
      return;
    }

    /**
     * @type Object.<string, Object.<string, TranslationFileReport>>
     */
    const comparisonReports = {};
    compareLocales.forEach((locale) => {
      const fileReports = compareTranslationsKeysForLocale(sharedFolderPaths, defaultBase, compareBase, 'en', locale);
      comparisonReports[locale] = fileReports;
    });

    Object.entries(comparisonReports).forEach(([locale, reports]) => {
      core.info(`Report for "${locale}":`);

      Object.entries(reports).forEach(([path, report]) => {
        core.info(`  ${path}:`);
        if (report.errors.length > 0) {
          core.error(`    Errors`)
        }
        report.errors.forEach(error => core.error(`      ${error}`));

        if (report.keysToAdd.length > 0) {
          core.error(`    Keys to add:`)
        }
        report.keysToAdd.forEach(key => core.error(`      ${key}`));

        if (report.keysToRemove.length > 0) {
          core.error(`    Keys to remove:`)
        }
        report.keysToRemove.forEach(key => core.error(`      ${key}`));
      });
    });

    const ms = core.getInput('milliseconds');
    core.info(`Waiting ${ms} milliseconds ...`);

    core.debug(new Date().toTimeString()); // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
    await wait(parseInt(ms));
    core.info(new Date().toTimeString());

    core.setOutput('time', new Date().toTimeString());
    core.setOutput('comparisonReports', comparisonReports);
  } catch (error) {
    core.setFailed(error.message);
  }
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
    const defaultLocalePath = path.join(
      defaultBase,
      sharedPath,
      defaultLocale
    );
    const compareLocalePath = path.join(
      compareBase,
      sharedPath,
      compareLocale
    );

    core.info('PROCESSING sharedPath: ' + sharedPath);

    try {
      const defaultPaths =
        getTranslationFilesAndKeyPrefixes(defaultLocalePath, customPrefix);

      defaultPaths.forEach(({ full, file, prefix, subfolder}) => {
        const defaultPathToOpen = path.normalize(full);
        const compareFileToOpen = path.normalize(path.join(compareLocalePath, subfolder, file));

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
          const defaultTranslationsJSON = fs.readFileSync(defaultPathToOpen, 'utf8');
          const defaultTranslations = JSON.parse(defaultTranslationsJSON);
          
          try {
            const compareTranslationsJSON = fs.readFileSync(compareFileToOpen, 'utf8');
            const compareTranslations = JSON.parse(compareTranslationsJSON);

            const defaultKeys = getTranslationKeyPaths(prefix, defaultTranslations);
            const compareKeys = getTranslationKeyPaths(prefix, compareTranslations);
            const fullKeysToAdd = [...defaultKeys].filter((key) => !compareKeys.has(key));
            const fullKeysToremove = [...compareKeys].filter((key) => !defaultKeys.has(key));

            fileReport.keysToAdd = getFullAndFileRelativeKeys(prefix, fullKeysToAdd);
            fileReport.keysToRemove = getFullAndFileRelativeKeys(prefix, fullKeysToremove);
          } catch (e) {
            // compareFileToOpen opening error
            fileReport.errors.push(e.toString());
          }
        } catch (e) {
          // defaultPathToOpen opening error
          fileReport.errors.push(e.toString());
        }

        pathToStringsReport[compareFileToOpen] = fileReport;
      });
    } catch (e) {
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
    const stat = fs.statSync(dirPath)
    if (stat.isDirectory() && f.length > 0 && f[0] !== '.') {
      paths.push(
        ...getTranslationFilesAndKeyPrefixes(
          dirPath,
          prefix ? `${prefix}.${f}` : f,
          root
        )
      );
    } else if (stat.isFile() && f === 'translation.json') {
      paths.push({ full: dirPath, file: f, dir, prefix, subfolder: path.relative(root, dir) });
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
        keyPaths = new Set([...keyPaths.values(), ...getTranslationKeyPaths(newKeyPath, value).values()]);
      }
    } else {
      keyPaths.add(newKeyPath);
    }
  });
  return keyPaths;
}

run();
