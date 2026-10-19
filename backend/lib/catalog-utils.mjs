export function ensureLeoSupplier(db) {
  let supplier = db.col('suppliers').find((s) => s.name === 'Leo Madeiras')
  if (!supplier) {
    supplier = db.insert('suppliers', {
      code: db.nextCode('FOR'),
      name: 'Leo Madeiras',
      category: 'chapas',
      contact: '',
      phone: '',
      email: '',
      website: 'https://www.leomadeiras.com.br',
      address: '',
      paymentTerms: '',
      leadTimeDays: 3,
      rating: 4,
      status: 'ativo',
      notes: 'Fornecedor principal de chapas, ferragens e fitas de borda. Catálogo e preços em R$ sincronizados do IROD-Orça.',
    })
  }
  return supplier
}

export function materialFromCatalog(item, supplierId) {
  const categoryMap = { chapa: 'chapa', ferragem: 'ferragem', fita: 'fita_borda' }
  return {
    code: item.code,
    catalogId: item.id,
    name: item.name,
    category: categoryMap[item.kind] ?? 'insumo',
    subcategory: item.category,
    unit: item.unit,
    cost: item.price ?? 0,
    priceSource: 'leo_madeiras',
    priceUpdatedAt: item.updatedAt ?? new Date().toISOString(),
    brand: item.brand ?? '',
    thickness: item.thickness,
    sheetWidth: item.kind === 'chapa' ? item.width : null,
    sheetHeight: item.kind === 'chapa' ? item.height : null,
    stock: 0,
    minStock: 0,
    location: '',
    supplierId,
    imageUrl: item.image,
    sourceUrl: item.url,
    active: true,
  }
}
