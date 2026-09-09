const roomUrl = 'https://toccata-and-fugue.duckdns.org/';

export function RoomCode() {
  return (
    <figure className="room-code">
      <a href={roomUrl} aria-label="Открыть Room">
        <img src="/room-qr.svg" alt="QR-код для подключения к Room" />
      </a>
      <figcaption>toccata-and-fugue.duckdns.org</figcaption>
    </figure>
  );
}
