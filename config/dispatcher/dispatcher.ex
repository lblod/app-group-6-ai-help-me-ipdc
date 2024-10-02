defmodule Dispatcher do
  use Matcher
  define_accept_types [
    html: [ "text/html", "application/xhtml+html" ],
    json: [ "application/json", "application/vnd.api+json" ],
    sparql: [ "application/sparql-results+json" ]
  ]

  @any %{}
  @json %{ accept: %{ json: true } }
  @html %{ accept: %{ html: true } }

  define_layers [ :static, :sparql, :services, :fall_back, :not_found ]

  ###############
  # SPARQL
  ###############

  match "/sparql", %{ layer: :sparql } do
    forward conn, [], "http://database:8890/sparql"
  end


  # In order to forward the 'themes' resource to the
  # resource service, use the following forward rule:
  #
  # match "/themes/*path", @json do
  #   Proxy.forward conn, path, "http://resource/themes/"
  # end
  #
  # Run `docker-compose restart dispatcher` after updating
  # this file.

  match "/public-services/*path", @json do
       Proxy.forward conn, path, "http://resource/public-services/"
  end

  match "/requirements/*path", @json do
       Proxy.forward conn, path, "http://resource/requirements/"
  end
  
  get "/query-sentence/*path", @json do
    IO.puts("Yielding query sentence")
    Proxy.forward conn, [], "http://embedding/query-sentence"
  end

  match "/procedures/*path", @json do
       Proxy.forward conn, path, "http://resource/procedures/"
  end

  # FRONTEND

  match "/assets/*path", %{ layer: :static } do
    Proxy.forward conn, path, "http://frontend/assets/"
  end

  match "/@appuniversum/*path", %{ layer: :static } do
    Proxy.forward conn, path, "http://frontend/@appuniversum/"
  end

  match "/*path", %{ layer: :fall_back } do
    Proxy.forward conn, [], "http://frontend/index.html"
  end


  match "/*_", %{ layer: :not_found } do
    send_resp( conn, 404, "Route not found.  See config/dispatcher.ex" )
  end
end
