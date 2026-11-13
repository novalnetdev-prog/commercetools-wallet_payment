import { Static, Type } from "@sinclair/typebox";

export const SupportedPaymentComponentsData = Type.Object({
  type: Type.String(),
  subtypes: Type.Optional(Type.Array(Type.String())),
});

/**
 * Supported payment components schema.
 *
 * Example:
 * {
 *   "components": [
 *     {
 *       "type": "card"
 *     },
 *     {
 *       "type": "applepay"
 *     }
 *   ]
 * }
 */
export const SupportedPaymentComponentsSchema = Type.Object({
  components: Type.Array(SupportedPaymentComponentsData),
  // Keep capability discovery aligned with the commercetools payment template.
  dropins: Type.Array(Type.Object({ type: Type.Literal("embedded") })),
  // Express Payments are not implemented; advertise an empty list.
  express: Type.Array(Type.Object({ type: Type.String() })),
});

export type SupportedPaymentComponentsSchemaDTO = Static<
  typeof SupportedPaymentComponentsSchema
>;
