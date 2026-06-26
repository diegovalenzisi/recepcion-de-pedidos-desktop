import React from 'react';
import { Page, Text, View, Document, StyleSheet, Font } from '@react-pdf/renderer';
import { getBusinessName } from '@/lib/businessNameUtils';

Font.register({
  family: 'Oswald',
  src: 'https://fonts.gstatic.com/s/oswald/v13/Y_TKV6o8WovbUd3m_X9aAA.ttf'
});

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#333'
  },
  header: {
    textAlign: 'center',
    marginBottom: 20,
    borderBottom: '1px solid #ccc',
    paddingBottom: 10
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#555'
  },
  headerGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10
  },
  section: {
    marginBottom: 15,
    border: '1px solid #eee',
    borderRadius: 3
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    backgroundColor: '#f2f2f2',
    padding: 5,
    borderBottom: '1px solid #eee'
  },
  table: {
    display: "table",
    width: "auto",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomColor: '#eee',
    borderBottomWidth: 1,
    alignItems: 'center',
    minHeight: 20
  },
  tableColHeader: {
    width: '25%',
    backgroundColor: '#f9f9f9',
    padding: 5,
    fontWeight: 'bold'
  },
  tableCol: {
    width: '25%',
    padding: 5
  },
  textRight: {
    textAlign: 'right'
  },
  conceptCol: {
    width: '40%',
    padding: 5
  },
  amountCol: {
    width: '20%',
    padding: 5,
    textAlign: 'right'
  },
  bold: {
    fontWeight: 'bold'
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 8,
    color: 'grey',
  },
  parcialesRow: {
    backgroundColor: '#f0f0f0',
    fontWeight: 'bold'
  }
});

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
};

const formatCostCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amount || 0);
};

const ReportRow = ({ concept, income, expense, cash, style = {} }) => (
  <View style={[styles.tableRow, style]} wrap={false}>
    <Text style={styles.conceptCol}>{concept}</Text>
    <Text style={styles.amountCol}>{formatCurrency(income)}</Text>
    <Text style={styles.amountCol}>{formatCurrency(expense)}</Text>
    <Text style={styles.amountCol}>{formatCurrency(cash)}</Text>
  </View>
);

const Section = ({ title, rows }) => (
  <View style={styles.section} wrap={false}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.table}>
      {rows.map((row, i) => <ReportRow key={i} {...row} />)}
    </View>
  </View>
);

const ShiftReportDocument = ({ data }) => {
  const { header, sections, summary } = data;
  
  // Get location-specific business name
  const businessName = getBusinessName();
  const totalCost = summary?.totalCost || header.totalCost || 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{businessName} - {header.localName}</Text>
          <View style={styles.headerGrid}>
            <Text style={styles.headerSubtitle}>Ventas Turno: {formatCurrency(header.totalSales)}</Text>
            <Text style={styles.headerSubtitle}>Costo Total: {formatCostCurrency(totalCost)}</Text>
            <Text style={styles.headerSubtitle}>Sobrante: {formatCurrency(header.difference)}</Text>
          </View>
           <View style={styles.headerGrid}>
            <Text style={styles.headerSubtitle}>Cierre Turno: {header.closeDate}</Text>
            <Text style={styles.headerSubtitle}>Turno Nro: {header.shiftId}</Text>
          </View>
        </View>

        <View style={[styles.tableRow, { borderBottom: '2px solid #333' }]} fixed>
            <Text style={styles.conceptCol}><Text style={styles.bold}>Concepto</Text></Text>
            <Text style={styles.amountCol}><Text style={styles.bold}>Ingresos</Text></Text>
            <Text style={styles.amountCol}><Text style={styles.bold}>Egresos</Text></Text>
            <Text style={styles.amountCol}><Text style={styles.bold}>Efectivo</Text></Text>
        </View>
        
        {sections.map(section => (
            <View key={section.title} wrap={false}>
                {section.rows.map((row, i) => (
                    <ReportRow key={i} {...row} style={row.isPartial ? styles.parcialesRow : {}}/>
                ))}
            </View>
        ))}

        <Text style={styles.footer}>Generado el {new Date().toLocaleString('es-AR')} - {businessName}</Text>
      </Page>
    </Document>
  );
};

export default ShiftReportDocument;