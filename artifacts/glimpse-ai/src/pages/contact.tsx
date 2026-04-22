import React from "react";
import Layout from "../components/layout";
import { Mail, MessageSquare, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function Contact() {
  return (
    <Layout>
      <div className="p-8 max-w-3xl mx-auto w-full">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Contact Us</h1>
        <p className="text-zinc-400 mb-8">We'd love to hear from you. Reach out using any of the channels below.</p>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-6 text-center">
              <Mail className="w-8 h-8 text-teal-400 mx-auto mb-3" />
              <h3 className="font-medium text-sm mb-1">Email</h3>
              <a href="mailto:futuretechvision.global@gmail.com" className="text-xs sm:text-sm text-teal-400 hover:text-teal-300 transition-colors break-words">
                futuretechvision.global@gmail.com
              </a>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-6 text-center">
              <MessageSquare className="w-8 h-8 text-blue-400 mx-auto mb-3" />
              <h3 className="font-medium text-sm mb-1">Live Chat</h3>
              <p className="text-sm text-zinc-400">Available on the dashboard</p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-6 text-center">
              <MapPin className="w-8 h-8 text-purple-400 mx-auto mb-3" />
              <h3 className="font-medium text-sm mb-1">Location</h3>
              <p className="text-sm text-zinc-400">Bengaluru, India</p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center text-sm text-zinc-600">
          <p>We typically respond within 24 hours on business days.</p>
        </div>
      </div>
    </Layout>
  );
}
