
import React, { useState } from 'react';
import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

const DIAG_DATE = '17-06-2026';
const DIAG_TURNO = '42';

const CajaDiagnosticPanel = () => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const db = getDatabase();
      const localId = getCurrentLocalId();
      const [day, month, year] = DIAG_DATE.split('-');

      const cajasRef  = ref(db, `${localId}/CAJAS/${DIAG_DATE}/turnos/${DIAG_TURNO}`);
      const backupRef = ref(db, `${localId}/BACKUP/${year}/${month}/${day}/TURNO/${DIAG_TURNO}/CAJA`);

      const [cajasSnap, backupSnap] = await Promise.all([get(cajasRef), get(backupRef)]);

      setResult({
        localId,
        cajas: {
          path: `${localId}/CAJAS/${DIAG_DATE}/turnos/${DIAG_TURNO}`,
          found: cajasSnap.exists(),
          data: cajasSnap.exists() ? cajasSnap.val() : null,
        },
        backup: {
          path: `${localId}/BACKUP/${year}/${month}/${day}/TURNO/${DIAG_TURNO}/CAJA`,
          found: backupSnap.exists(),
          data: backupSnap.exists() ? backupSnap.val() : null,
        },
      });
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-orange-300">
      <CardHeader className="bg-orange-50 pb-3">
        <CardTitle className="text-base text-orange-800">
          Diagnóstico — Turno {DIAG_TURNO} ({DIAG_DATE})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <Button onClick={run} disabled={loading} size="sm" variant="outline">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? 'Leyendo Firebase...' : 'Ejecutar diagnóstico'}
        </Button>

        {result?.error && (
          <p className="mt-3 text-red-600 text-sm font-mono">{result.error}</p>
        )}

        {result && !result.error && (
          <div className="mt-4 space-y-4 text-xs font-mono">
            {[result.cajas, result.backup].map((node) => (
              <div key={node.path} className="border rounded p-3">
                <div className="flex items-center gap-2 mb-1">
                  {node.found
                    ? <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                  <span className={`font-bold text-sm ${node.found ? 'text-green-700' : 'text-red-600'}`}>
                    {node.found ? 'ENCONTRADO' : 'NO ENCONTRADO'}
                  </span>
                </div>
                <p className="text-gray-400 break-all mb-2 text-xs">{node.path}</p>
                {node.data && (
                  <pre className="bg-gray-50 border p-2 rounded overflow-auto max-h-72 text-xs leading-relaxed whitespace-pre-wrap">
                    {JSON.stringify(node.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CajaDiagnosticPanel;
