#!/bin/bash
# Double-cliquez sur ce fichier pour lancer le site avec les modèles 3D.
# Il démarre un petit serveur local et ouvre la page dans votre navigateur.

cd "$(dirname "$0")" || exit 1

PORT=8000
# Si notre serveur tourne déjà, réutilise exactement la même adresse. Le cache
# du navigateur est lié au port : ouvrir 8001 créerait un nouveau cache.
if curl -fs "http://localhost:$PORT/index.html" 2>/dev/null | grep -q "Mon Dessin Devient 3D"; then
  open "http://localhost:$PORT/index.html"
  exit 0
fi

# Trouve un port libre si 8000 est occupé par une autre application.
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT+1))
done

echo "------------------------------------------------------------"
echo "  Mon Dessin Devient 3D - serveur local"
echo "  Adresse : http://localhost:$PORT/index.html"
echo ""
echo "  >>> LAISSEZ CETTE FENETRE OUVERTE pendant que vous"
echo "      utilisez le site. Fermez-la pour arreter le serveur."
echo "------------------------------------------------------------"

# Ouvre le navigateur apres un court delai
( sleep 1 ; open "http://localhost:$PORT/index.html" ) &

# Demarre le serveur (bloquant)
python3 -m http.server $PORT
