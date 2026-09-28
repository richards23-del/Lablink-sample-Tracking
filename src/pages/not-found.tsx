import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="min-h-[50vh] w-full flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">
              404 Page Not Found
            </h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            This page could not be found. Check the address or return to your
            workspace.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block font-semibold text-primary hover:underline"
          >
            Back to command center
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
