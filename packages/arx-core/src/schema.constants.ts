import type { Options } from "ajv";
import type { FormatName } from "ajv-formats";

export const AJV_OPTIONS: Options = { allErrors: true, strict: true, strictTuples: false };

export const SCHEMA_FORMATS: FormatName[] = ["uri-reference"];
