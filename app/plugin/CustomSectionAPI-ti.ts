/**
 * This module was automatically generated by `ts-interface-builder`
 */
import * as t from "ts-interface-checker";
// tslint:disable:object-literal-key-quotes

export const ColumnToMap = t.iface([], {
  "name": "string",
  "title": t.opt(t.union("string", "null")),
  "description": t.opt(t.union("string", "null")),
  "type": t.opt("string"),
  "optional": t.opt("boolean"),
  "allowMultiple": t.opt("boolean"),
  "strictType": t.opt("boolean"),
});

export const ColumnsToMap = t.array(t.union("string", "ColumnToMap"));

export const InteractionOptionsRequest = t.iface([], {
  "requiredAccess": t.opt("string"),
  "hasCustomOptions": t.opt("boolean"),
  "columns": t.opt("ColumnsToMap"),
  "allowSelectBy": t.opt("boolean"),
});

export const InteractionOptions = t.iface([], {
  "accessLevel": "string",
});

export const WidgetColumnMap = t.iface([], {
  [t.indexKey]: t.union("string", t.array("string"), "null"),
});

export const CustomSectionAPI = t.iface([], {
  "configure": t.func("void", t.param("customOptions", "InteractionOptionsRequest")),
  "mappings": t.func(t.union("WidgetColumnMap", "null")),
});

const exportedTypeSuite: t.ITypeSuite = {
  ColumnToMap,
  ColumnsToMap,
  InteractionOptionsRequest,
  InteractionOptions,
  WidgetColumnMap,
  CustomSectionAPI,
};
export default exportedTypeSuite;
