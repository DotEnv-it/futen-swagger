import ts from 'typescript';

export type Types = string | number | boolean | object | undefined;
export type Property = Types | ReturnTypeObject;
export type Properties = Array<Property>;
export interface ReturnTypeObject {
    returnType: string;
    properties: Properties;
    caller?: string;
}

// eslint-disable-next-line @typescript-eslint/ban-types
export type CompileableFunctions = Record<string, Array<string | Function> | string | Function | undefined>;
function compileFunctions(functions: CompileableFunctions): string {
    let source = '';
    Object.entries(functions).forEach(([key, func]) => {
        if (Array.isArray(func)) {
            for (let i = 0; i < func.length; i++) {
                const f = func[i];
                if (typeof f === 'string') source += f;
                else if (typeof f === 'function') {
                    const type = f.toString().startsWith('() =>') ? 'const' : 'function';
                    if (type === 'const') source += `const ${key}_${f.name || 'f'} = ${f.toString()};`;
                    else source += f.toString().replace(/^(?:function)?(?:.*)\s*\((.*)\)/, `function ${key}_${f.name || 'f'}($1)`);
                }
                source += '\n';
            }
        } else if (typeof func === 'string') source += func;
        else if (typeof func === 'function') {
            const type = func.toString().startsWith('() =>') ? 'const' : 'function';
            if (type === 'const') source += `const ${key}_${func.name || 'f'} = ${func.toString()};`;
            else source += func.toString().replace(/^(?:function)?(?:.*)\s*\((.*)\)/, `function ${key}_${func.name || 'f'}($1)`);
        }
        source += '\n';
    });
    return source;
}

function compileImportStatements(): string {
    const projectDir = process.cwd();
    if (!ts.sys.directoryExists(projectDir)) return '';
    const projectFiles = ts.sys.readDirectory(projectDir, ['.ts', '.mts'], ['node_modules']);
    if (projectFiles.length === 0) return '';
    const importMap = new Map<string, { typeImports: Set<string>, valueImports: Set<string> }>();
    for (const filePath of projectFiles) {
        const content = ts.sys.readFile(filePath);
        if (!content) continue;
        const importRegex = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            let [, typeKeyword, importsList, module] = match;
            const isType = Boolean(typeKeyword);
            const importItems = importsList.split(',').map((item) => item.trim());
            for (let i = 0; i < importItems.length; i++) {
                const item = importItems[i];
                if (isType) {
                    for (const [, importData] of importMap) {
                        if (importData.typeImports.has(item)) {
                            importItems.splice(i, 1);
                            i--;
                            break;
                        }
                    }
                } else {
                    for (const [, importData] of importMap) {
                        if (importData.valueImports.has(item)) {
                            importItems.splice(i, 1);
                            i--;
                            break;
                        }
                    }
                }
            }
            const isRelativeImport = module.startsWith('.');
            if (isRelativeImport) {
                const resolvedModule = ts.resolveModuleName(module, filePath, {}, ts.sys).resolvedModule?.resolvedFileName;
                if (!resolvedModule) continue;
                if (!resolvedModule.endsWith('.ts')) continue;
                module = resolvedModule;
            }
            if (!importMap.has(module))
                importMap.set(module, { typeImports: new Set<string>(), valueImports: new Set<string>() });
            const currentImports = importMap.get(module);
            if (!currentImports) continue;
            if (isType) {
                for (let i = 0; i < importItems.length; i++) {
                    const item = importItems[i];
                    currentImports.valueImports.delete(item);
                    currentImports.typeImports.add(item);
                }
            } else {
                for (let i = 0; i < importItems.length; i++) {
                    const item = importItems[i];
                    if (!currentImports.typeImports.has(item))
                        currentImports.valueImports.add(item);
                }
            }
        }
    }
    const result: string[] = [];
    for (const [module, importData] of importMap.entries()) {
        if (importData.valueImports.size > 0)
            result.push(`import { ${Array.from(importData.valueImports).join(', ')} } from '${module}'`);

        if (importData.typeImports.size > 0)
            result.push(`import type { ${Array.from(importData.typeImports).join(', ')} } from '${module}'`);
    }
    return result.join('\n');
}

function loadProjectTypes(options: ts.CompilerOptions): Record<string, ts.SourceFile> {
    const projectDir = process.cwd();
    if (!ts.sys.directoryExists(projectDir)) return {};
    const projectFiles = ts.sys.readDirectory(projectDir, ['.d.ts', '.d.mts', '.ts', '.mts', '.js', '.mjs'], ['node_modules']);
    if (projectFiles.length === 0) return {};
    const files: Record<string, ts.SourceFile> = {};
    for (let i = 0; i < projectFiles.length; i++) {
        const filePath = projectFiles[i];
        const content = ts.sys.readFile(filePath);
        if (!content) continue;
        files[filePath] = ts.createSourceFile(filePath, content, options.target ?? ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    }
    return files;
}

function loadDependencies(options: ts.CompilerOptions): Record<string, ts.SourceFile> {
    const libPath = `${process.cwd()}/node_modules`;
    if (!ts.sys.directoryExists(libPath)) return {};
    const directories = ts.sys.getDirectories(libPath);
    if (directories.length === 0) return {};
    const files: Record<string, ts.SourceFile> = {};
    for (let i = 0; i < directories.length; i++) {
        const libDtsFiles = ts.sys.readDirectory(`${libPath}/${directories[i]}`, ['.d.ts', '.d.mts']);
        libDtsFiles.forEach((filePath) => {
            const content = ts.sys.readFile(filePath);
            if (!content) return;
            const fileName = filePath.split('/node_modules/').pop();
            if (content && fileName)
                files[fileName] = ts.createSourceFile(fileName, content, options.target ?? ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
        });
    }
    return files;
}

function convertToAST(sourceCode: string): [ts.NodeArray<ts.Statement>, ts.TypeChecker] {
    const filePath = 'generated.ts';
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true
    };
    const importStatements = compileImportStatements();
    const sourceCodeWithImports = `${importStatements}\n${sourceCode}`;
    const sourceFile = ts.createSourceFile(filePath, sourceCodeWithImports, options.target ?? ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const files: Record<string, ts.SourceFile | undefined> = {
        ...loadDependencies(options),
        ...loadProjectTypes(options),
        [filePath]: sourceFile
    };
    const compilerHost: ts.CompilerHost = {
        writeFile: () => { /*A*/ },
        getNewLine: () => '\n',
        getDirectories: () => [],
        getCurrentDirectory: () => '',
        getEnvironmentVariable: () => '',
        getCanonicalFileName: (fileName: string) => fileName,
        getSourceFile: (fileName: string) => files[fileName],
        fileExists: (fileName: string) => files[fileName] !== undefined,
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
        readFile: (fileName: string) => files[fileName]?.getFullText() ?? undefined,
        getDefaultLibFileName: (defaultLibOptions: ts.CompilerOptions) => ts.getDefaultLibFileName(defaultLibOptions)
    };
    const program = ts.createProgram(Object.keys(files), options, compilerHost);
    return [sourceFile.statements, program.getTypeChecker()];
}

function getAllFunctionReturnStatements(node: ts.Node): ts.ReturnStatement[] {
    const returnStatements: ts.ReturnStatement[] = [];
    if (ts.isReturnStatement(node))
        returnStatements.push(node);
    node.forEachChild((child) => {
        returnStatements.push(...getAllFunctionReturnStatements(child));
    });
    return returnStatements;
}

function parseObjectLiteral(node: ts.ObjectLiteralExpression, checker: ts.TypeChecker): Record<string, Types> {
    const result = {} as Record<string, Types>;
    node.properties.forEach((property) => {
        if (ts.isPropertyAssignment(property)) {
            const name = property.name.getText();
            const value = property.initializer;
            result[name] = parseValue(value, checker);
        } else if (ts.isShorthandPropertyAssignment(property)) {
            const { name } = property;
            result[name.getText()] = parseValue(name, checker);
        } else if (ts.isSpreadAssignment(property)) {
            const { expression } = property;
            if (ts.isObjectLiteralExpression(expression)) {
                const spread = parseObjectLiteral(expression, checker);
                Object.assign(result, spread);
            }
        }
    });
    return result;
}

function parseDeclaration(node: ts.Declaration, checker: ts.TypeChecker): Property {
    if (ts.isVariableDeclaration(node)) {
        const { initializer } = node;
        if (!initializer) return undefined;
        return parseValue(initializer, checker);
    } else if (ts.isShorthandPropertyAssignment(node)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(node);
        if (symbol === undefined) return undefined;
        const declarations = symbol.getDeclarations();
        if (declarations === undefined) return undefined;
        const { 0: declaration } = declarations;
        return parseDeclaration(declaration, checker);
    } else if (ts.isPropertyAssignment(node)) {
        const { initializer } = node;
        return parseValue(initializer, checker);
    } else if (ts.isBindingElement(node)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol === undefined) return undefined;
        return checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node));
    } else if (ts.isImportSpecifier(node)) {
        const nameSymbol = checker.getSymbolAtLocation(node.name);
        if (nameSymbol === undefined) return undefined;
        const aliasedSymbol = checker.getAliasedSymbol(nameSymbol);
        const declarations = aliasedSymbol.getDeclarations();
        if (declarations === undefined) return undefined;
        const { 0: declaration } = declarations;
        return parseDeclaration(declaration, checker);
    }
    return undefined;
}

function parseCallExpression(node: ts.CallExpression, checker: ts.TypeChecker): ReturnTypeObject | undefined {
    const resolvedType = checker.getResolvedSignature(node);
    if (!resolvedType) return undefined;

    const signatureReturnType = checker.getReturnTypeOfSignature(resolvedType);
    const returnTypeSymbol = signatureReturnType.getSymbol();
    if (!returnTypeSymbol) {
        const { expression } = node;
        const expressionType = checker.getTypeAtLocation(expression);
        const callSignatures = expressionType.getCallSignatures();
        if (callSignatures.length === 0) return undefined;
        const returnType = checker.typeToString(callSignatures[0].getReturnType());
        const properties: Properties = [];
        for (const arg of node.arguments) properties.push(parseValue(arg, checker));
        return { returnType, properties, caller: expression.getText() };
    }

    const returnType = returnTypeSymbol.getName();
    const { typeArguments } = signatureReturnType as ts.TypeReference;
    if (typeArguments && typeArguments.length > 0) {
        const properties: Properties = [];
        typeArguments[0].getProperties().forEach((property) => {
            if (property.valueDeclaration === undefined) return;
            properties.push({ [property.getName()]: parseDeclaration(property.valueDeclaration, checker) });
        });
        return { returnType, properties, caller: node.expression.getText() };
    }

    const properties: Properties = [];
    node.arguments.forEach((arg) => {
        properties.push(parseValue(arg, checker));
    });
    return { returnType, properties, caller: node.expression.getText() };
}

function parseBindingName(node: ts.BindingName, checker: ts.TypeChecker): Property {
    if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol === undefined) return undefined;
        const declarations = symbol.getDeclarations();
        if (declarations === undefined) return undefined;
        const { 0: declaration } = declarations;
        return parseDeclaration(declaration, checker);
    } else if (ts.isObjectBindingPattern(node)) {
        const properties: Properties = [];
        node.elements.forEach((element) => {
            properties.push(parseBindingName(element.name, checker));
        });
        return properties;
    }
    return undefined;
}

function parseArrowFunction(node: ts.ArrowFunction, checker: ts.TypeChecker): ReturnTypeObject | undefined {
    const resolvedType = checker.getSignatureFromDeclaration(node);
    if (!resolvedType) return undefined;
    const returnType = checker.typeToString(resolvedType.getReturnType());
    const properties: Properties = [];
    node.parameters.forEach((param) => {
        const { name } = param;
        properties.push(parseBindingName(name, checker));
    });
    return { returnType, properties };
}

function parseValue(node: ts.Expression, checker: ts.TypeChecker): Property {
    if (ts.isStringLiteral(node))
        return node.text;
    else if (ts.isNumericLiteral(node))
        return parseFloat(node.text);
    else if (ts.isObjectLiteralExpression(node))
        return parseObjectLiteral(node, checker);
    else if (ts.isAwaitExpression(node))
        return parseValue(node.expression, checker);
    else if (ts.isCallExpression(node))
        return parseCallExpression(node, checker);
    else if (ts.isArrowFunction(node))
        return parseArrowFunction(node, checker);
    else if (ts.isVariableDeclaration(node)) {
        const value = node.initializer;
        if (!value) return undefined;
        return parseValue(value, checker);
    } else if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol === undefined) return undefined;
        const declarations = symbol.getDeclarations();
        if (declarations === undefined) return undefined;
        const { 0: declaration } = declarations;
        return parseDeclaration(declaration, checker);
    } else if (ts.isArrayLiteralExpression(node)) {
        const elements: Array<Property> = [];
        node.elements.forEach((element) => {
            elements.push(parseValue(element, checker));
        });
        return elements;
    } else if (ts.isNewExpression(node)) {
        const { expression } = node;
        const properties: Properties = [];
        if (!node.arguments) return undefined;
        for (const arg of node.arguments) properties.push(parseValue(arg, checker));
        const type = expression.getText();
        return { returnType: type, properties };
    } else if (ts.isPropertyAccessExpression(node)) {
        const { expression } = node;
        const type = checker.getTypeAtLocation(expression);
        return checker.typeToString(type);
    }
    const type = checker.getTypeAtLocation(node);
    return checker.typeToString(type);
}

function unpackReturnStatementCallExpression(node: ts.ReturnStatement, checker: ts.TypeChecker): string | number | Record<string, Properties> | ReturnTypeObject | undefined {
    if (node.expression !== undefined) {
        if (ts.isCallExpression(node.expression)) {
            const { expression } = node;
            const expressionType = checker.getTypeAtLocation(expression);
            const returnType = checker.typeToString(expressionType);
            const properties = [];
            for (const arg of expression.arguments) properties.push(parseValue(arg, checker));
            return { returnType, properties, caller: expression.expression.getText() };
        } else if (ts.isNewExpression(node.expression)) {
            const { expression } = node;
            const properties = [];
            if (!expression.arguments) return undefined;
            for (const arg of expression.arguments) properties.push(parseValue(arg, checker));

            const typeExpression = expression.expression;
            const type = typeExpression.getText();
            return { returnType: type, properties };
        } // on the off chance that it's a simple return statement
        const type = checker.getTypeAtLocation(node.expression);
        return { returnType: checker.typeToString(type), properties: [] };
    }
    return undefined;
}

export function getCompiledFunctionsReturnTypes(functions: CompileableFunctions): Record<string, Properties> {
    const compiledFunctions = compileFunctions(functions);
    const [statements, checker] = convertToAST(compiledFunctions);
    const returnTypes: Record<string, Properties> = {};
    statements.forEach((statement) => {
        if (ts.isFunctionDeclaration(statement) || ts.isFunctionExpression(statement)) {
            const statementName = statement.name?.getText();
            if (!statementName) return;
            const returnStatements = getAllFunctionReturnStatements(statement);
            returnTypes[statementName] = [];
            returnStatements.forEach((returnStatement) => {
                const unpacked = unpackReturnStatementCallExpression(returnStatement, checker);
                if (unpacked !== undefined)
                    returnTypes[statementName].push(unpacked);
            });
        } else if (ts.isVariableStatement(statement)) {
            statement.declarationList.declarations.forEach((declaration) => {
                const statementName = declaration.name.getText();
                if (!statementName) return;
                const returnStatements = getAllFunctionReturnStatements(declaration);
                returnTypes[statementName] = [];
                returnStatements.forEach((returnStatement) => {
                    const unpacked = unpackReturnStatementCallExpression(returnStatement, checker);
                    if (unpacked !== undefined)
                        returnTypes[statementName].push(unpacked);
                });
            });
        }
    });
    return returnTypes;
}
