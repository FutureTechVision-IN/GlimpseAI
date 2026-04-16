import React from "react";
import Layout from "../components/layout";
import { useGetPaymentHistory } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Billing() {
  const { data: payments, isLoading } = useGetPaymentHistory();

  return (
    <Layout>
      <div className="p-8 max-w-5xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
          <p className="text-zinc-400 mt-1">Manage your subscription and view payment history.</p>
        </div>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
            <CardDescription className="text-zinc-400">A record of your past transactions.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-8"><div className="w-6 h-6 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" /></div>
            ) : payments && payments.length > 0 ? (
              <div className="rounded-md border border-zinc-800">
                <Table>
                  <TableHeader className="bg-zinc-900/50">
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Date</TableHead>
                      <TableHead className="text-zinc-400">Amount</TableHead>
                      <TableHead className="text-zinc-400">Status</TableHead>
                      <TableHead className="text-zinc-400">Billing Period</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id} className="border-zinc-800 hover:bg-zinc-900/50">
                        <TableCell className="font-medium">{new Date(payment.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>{payment.amount} {payment.currency}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            payment.status === 'success' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' :
                            payment.status === 'failed' ? 'border-red-500/50 text-red-400 bg-red-500/10' :
                            'border-zinc-500/50 text-zinc-400 bg-zinc-500/10'
                          }>
                            {payment.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize text-zinc-400">{payment.billingPeriod || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                No payment history found.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
