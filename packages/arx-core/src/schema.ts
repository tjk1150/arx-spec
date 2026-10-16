import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../schema/arx-0.1.schema.json";
import { error, type Issue } from "./issues";
import { AJV_OPTIONS, SCHEMA_FORMATS } from "./schema.constants";

const ajv = new Ajv2020(AJV_OPTIONS);
addFormats(ajv, SCHEMA_FORMATS);
const validate = ajv.compile(schema);

/** Structural validation against the normative JSON Schema. */
export const checkSchema = (manifest: unknown): Issue[] => {
  if (validate(manifest)) return [];
  const seen = new Set<string>();
  return (validate.errors ?? []).flatMap((detail) => {
    const pointer = detail.instancePath || "/";
    const message = `${detail.message ?? "invalid"} (${detail.schemaPath})`;
    const key = `${pointer} ${message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [error("ARX_SCHEMA", pointer, message)];
  });
};
