import { guardCreateAction } from "./write-guards.js";

export function beforeCreateProduct({ tenant, currentCount, root }) {
  return guardCreateAction({
    resourceKey: "products",
    currentCount,
    tenant,
    mountNode: root
  });
}

export function beforeCreateCustomer({ tenant, currentCount, root }) {
  return guardCreateAction({
    resourceKey: "customers",
    currentCount,
    tenant,
    mountNode: root
  });
}

export function beforeCreateOrder({ tenant, currentCount, root }) {
  return guardCreateAction({
    resourceKey: "orders",
    currentCount,
    tenant,
    mountNode: root
  });
}
