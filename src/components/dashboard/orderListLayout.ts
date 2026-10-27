// Keep the headers and rows on the same tracks, including optional columns.
// Narrow screens use stacked cards instead of squeezing a desktop table.
export function getOrderListColumns(hideCaseId: boolean, showDeliveryDate: boolean) {
    if (hideCaseId) {
        return showDeliveryDate
            ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]'
            : 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]';
    }
    return showDeliveryDate
        ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]'
        : 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]';
}

export const orderListActionsClass = 'lg:ms-4 lg:w-56 lg:shrink-0';
