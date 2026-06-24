#!/bin/bash
# Double-cliquez sur ce fichier pour lancer le site avec les modèles 3D.
# Il démarre un petit serveur local et ouvre la page dans votre navigateur.

cd "$(dirname "$0")" || exit 1

PORT=8000
# Trouve un port libre si 8000 est déjà pris
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
