function parsePagination(query = {}, defaults = { page: 1, limit: 20, maxLimit: 100 }) {
  const page = Math.max(1, parseInt(query.page, 10) || defaults.page);
  const rawLimit = parseInt(query.limit, 10) || defaults.limit;
  const limit = Math.min(defaults.maxLimit || 100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildPaginatedResult(items, total, { page, limit }) {
  return {
    items,
    pagination: {
      total: Number(total || 0),
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
    },
  };
}

module.exports = {
  parsePagination,
  buildPaginatedResult,
};
