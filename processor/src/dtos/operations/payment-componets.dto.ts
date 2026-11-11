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
  // Checkout only displays the new embedded Drop-in after merchant opt-in.
  dropins: Type.Optional(Type.Array(Type.Object({ type: Type.Literal("embedded") }))),
});

export type SupportedPaymentComponentsSchemaDTO = Static<
  typeof SupportedPaymentComponentsSchema
>;
