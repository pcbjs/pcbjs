const OWN = /[\\/](?:pcbjs|@pcbjs[\\/][\w.-]+|packages[\\/](?:core|compile|export|lib|fab|cli|viewer|vscode))[\\/](?:dist|src)[\\/]/

/** True for pcbjs's own code, built or source, in a checkout (packages/<name>) or installed (node_modules/pcbjs, @pcbjs/<name>). */
export const isOwnFile = (file: string): boolean => OWN.test(file)
