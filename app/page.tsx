import { redirect } from 'next/navigation';

export default function Home() {
  // Redirect the root path to the circuit editor tool by default
  redirect('/circuit');
}
