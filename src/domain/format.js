export const fmt = (n) => Number(n.toFixed(2));
const displayNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
export const display = (n) => displayNumber.format(n);
